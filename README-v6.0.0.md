# Surnia v6.0.0 — "Apex": the programming-power release

**Built directly on the v5.0.0 baseline (nothing reverted — every v5 power is intact).**
Method: live reverse-engineering of **ZCode (Z.ai — the GLM company's agentic IDE)** — all 27 doc
pages — and **Google Antigravity** — 40 doc pages — plus a full security audit of the new surface.
See `docs/RELEASE-v6.0.0-PLAN.md` for the mapped feature plan.

---

## 1. The #1 promise: unbeatable programming power

- **Goal Verifier (ZCode Goal Mode × Antigravity stop-hook)** — a `/goal` no longer ends because
  the model *says* it is done. A separate evidence-based verifier pass re-reads the goal against
  the RECORDED evidence (files actually changed, commands actually run + exit status) and either
  confirms it (`VERIFIED` row in chat) or hands back ONE concrete next action — up to 3
  verification rounds. Confident prose is not proof anymore.
- **Adversarial Critic gate (Antigravity /teamwork Critic)** — trusted-mode runs that touched ≥3
  files get a read-only critic pass on the working diff hunting mocked/faked tests, facade code,
  broken imports and unverified claims. Critical findings start one auto-fix round. A `CRITIC`
  row shows the verdict.
- **Evidence Receipt (original)** — every substantial run ends with a `PROOF` card: files touched,
  commands with exit status, fix rounds, duration. Trust made visible.
- **24 scaffold templates** (was 19): new `vue-vite`, `svelte-vite`, `flask-api`, `php-site`,
  `kotlin-cli` — real manifests, runnable entrypoints, 8-test harness.
- **Error Explainer (original, AR-first)** — every failed tool result gets a one-click
  "اشرح هذا الخطأ وأصلحه · Explain this error" that makes the agent explain the error simply
  (in the user's language), then apply the minimal fix and re-run the failed command as proof.

## 2. From ZCode (reverse-engineered, 27 doc pages)

- **Repo Wiki (rail 10)** — a generated architecture wiki per workspace: catalog → pages pipeline
  with visible stages, stored OUTSIDE the repo (`userData/wiki/<hash>`), secret-hygiene scanner
  (never reads token/secret/credential/password/key/pem/jks/pfx-named files, .git, node_modules,
  symlinks), **auto-refresh detection** (a stats-only signature flags `CODE CHANGED` when the
  code drifted), two-column reader, language follows the UI.
- **6-way approvals with editable scope** (Safety Confirmation × Antigravity scope-edit) —
  Allow once / **Always allow** / **This session** / **Reject** / **Always reject** (persisted
  deny list — Deny beats Allow) on a 3×2 card, plus an editable "remember as" scope field
  (approve `npm` once, every npm subcommand is covered — token-boundary prefix matching).
  Keyboard: ↵ allow · ⌫ deny · A always · N never.
- **Import from other agents** — skills detected in `~/.claude/skills`, `~/.codex/skills`,
  `~/.config/opencode/skills`, `~/.gemini/config/skills`, `~/.gemini/skills` — one click copies
  them into your workspace/global library (never overwrites). MCP servers imported from
  `~/.claude/settings.json`, `~/.claude.json`, `~/.codex/config.toml`, `~/.config/opencode/config.json`,
  `~/.agents/mcp.json` — **shown with their full command line and imported disabled** (audit H-1).
- **Memory taxonomy + forget verb** — `remember` now takes the four curated types
  (user / feedback / project / reference) and `action:"forget"` removes matching entries from
  MEMORY.md and the DNA model.
- **Automations templates** — 4 read-only analysis templates (weekday standup digest, daily risk
  scan, Friday release brief, Wednesday doc sync) prefill the scheduler; read-only posture baked
  into the prompts.
- **Usage streaks** — current streak, longest streak, peak-hour slot in the Usage panel.

## 3. From Antigravity (reverse-engineered, 40 doc pages)

- **`gen_ui` tool (generative UI)** — the agent renders interactive single-file HTML widgets
  (charts, comparisons, mini-apps) with a STRICT contract: no external resources at all
  (entity-encoded URLs rejected too — audit M-3), written under `.surnia/widgets/` behind a
  write approval, opened in the Live Preview panel.
- **Pending artifact comments** — the Artifacts Hub has a comment box; comments queue as chips
  (hover the chip in the composer to inspect) and ride along with your NEXT message instead of
  interrupting a running agent.
- **`/grill` command + Grill-First skill** — interview-first planning: one question at a time,
  recommended option first, codebase questions answered by reading (never asking).
- **Web Verify Loop skill** — the mandatory see-it-before-done loop as a shipped skill.
- **`/handoff` command (original)** — a session-handoff note (HANDOFF.md: done / not done /
  how to run / gotchas) for resuming later or handing to a teammate.

## 4. Security — audited and hardened ("كاملة حرفياً")

A full read-only audit of the v6 surface produced 7 findings — **all fixed**:

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| H-1 | HIGH | Rival MCP import could spawn a hidden command | Imports land **disabled**, full command line visible in the row body |
| M-1 | MED | `wiki:generate` accepted any disk path from the renderer | Pinned to workspaces the app actually knows (recentPaths) |
| M-2 | MED | skills-import accepted any directory | Pinned to the five DETECTED rival roots |
| M-3 | MED | gen_ui external-resource filter bypassable via HTML entities | Entity-decode before the check |
| L-1 | LOW | Wiki secret-name filter gaps (`keys.json`, keystores…) | Widened filter |
| L-3 | LOW | Feedback diagnostics stored verbatim | Whitelisted to the five safe fields |
| L-4 | LOW | Web fence markers could be forged inside content | Markers neutralized (`<<<` → `«««`) |

Plus the **prompt-injection firewall**: every `web_search` / `web_fetch` result is now fenced as
`UNTRUSTED DATA` with instruction-spoofing openers stripped, and the system prompt forbids
treating web content as instructions (bilingual rule).

## 5. Design (soft × liquid)

- ChatGPT-soft surfaces with liquid-glass accents — verified by 13 fresh screenshots across
  soft/obsidian/midnight, EN+AR, every rail panel and the 16-pane settings.
- Bidi fix: the welcome model chip is LTR-isolated (the Arabic truncation artifact is gone).
- Full Arabic translations for every new v6 string (wiki, approvals, receipts, feedback…).

## 6. Suggestions & Contact (the side feature, done LAST as ordered)

**Settings → 16 — الاقتراحات والتواصل**: a suggestions box (bug / improvement / feature idea /
other), optional contact, opt-in diagnostics (version/OS/language/counters — never keys or paths),
submission history, copy-as-markdown, open the feedback folder. Submissions are LOCAL files
(`<userData>/feedback/`) — nothing leaves the machine until the user chooses to send.

## 7. Tests & build status

- `npm test` → **56/56 pass** (48 v5 + 8 new v6 template tests; memory test upgraded to the v6 contract).
- `npm run typecheck` → clean. Full production build green (vite + CSP post-build + preload).
- 8 built-in skills ship in the packaged asar (6 v5 + `grill-first` + `web-verify`).
- Direct-testing pass: 13 screenshots of every corner taken and REVIEWED; issues found were fixed
  (welcome bidi chip) before packaging.

## Honest note (doctrine unchanged)

The ceiling is still the model you connect. v6 makes sure that when the model claims it is done,
**evidence decides** — the verifier, the critic and the receipt are yours, not the model's.
