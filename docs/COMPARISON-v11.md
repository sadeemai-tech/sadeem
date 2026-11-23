# SADEEM v11.0.0 — REAL competitor comparison (researched 2026-11-13)

Honest, sourced comparison. Sources: official sites/docs and recent engineering
write-ups (opencode.ai, code.claude.com docs, cursor.com + forum, openai.com
Codex pages, northflank & composio Claude-Code-vs-Codex reviews, 2026).
Where SADEEM lacks something, it says so. Where SADEEM has something the
competitor lacks, it says so too.

Legend: ✔ = has it · ✖ = missing · ~ = partial/roadmap

## 1 · Feature matrix

| Capability | SADEEM 11 | OpenCode | Claude Code | Codex | Cursor | Hermes |
|---|---|---|---|---|---|---|
| Desktop GUI app (Windows) | ✔ (Win 10/11) | ✔ | ✖ (terminal) | ~ (macOS app; Win via CLI/IDE ext) | ✔ | ✔ |
| Multi-provider models (200+) | ✔ (Anthropic/OpenAI/Google/Groq/Z.AI/OpenRouter/Ollama + providers) | ✔ | Anthropic-only | OpenAI-only | ✔ (multi) | ✔ |
| Model racing (same task, parallel models, judged) | ✔ Arena: live leaderboard, real tests judge, merge-gate + rollback | ✖ | ✖ | ~ best-of-N cloud attempts (1–4), no arena UI | ✖ | ✖ |
| Parallel isolated worktrees | ✔ + judged merge | ~ multi-session | ✔ worktrees | ~ cloud isolation | ~ parallel agents | ✖ |
| **Signed run proofs (Ed25519) + false-done ledger** | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ |
| **Mutation gate (tests must flip red→green before "done")** | ✔ | ✖ | ~ verify hooks (DIY) | ~ (user-configured) | ~ (BugBot review only) | ✖ |
| MCP client | ✔ (+ one-click registry, allow/deny per tool, auto-quarantine) | ✔ | ✔ | ✔ | ✔ | ✔ |
| Skills (SKILL.md-style) | ✔ | ✔ | ✔ | ~ | ~ (rules) | ✔ |
| Plugins system | ✔ (bundled + manifest plugins w/ prompts+MCP) | ✔ (extensions) | ✔ (marketplaces) | ~ | ~ | ✖ |
| Custom agents/subagents | ~ (fixed reviewer/critic roles + task tool) | ✔ custom agents | ✔ subagents | ~ multi-agent (web) | ~ background agents | ✖ |
| Hooks (lifecycle automations) | ✔ (.surnia/hooks.json, trust-gated, tested) | ✔ | ✔ | ~ | ~ | ✖ |
| Scheduled jobs (cron + webhook triggers, local) | ✔ | ✖ | ✖ | ✖ | ~ (background agents are remote) | ~ |
| Flows (repeated prompts → one-click) | ✔ + auto-suggestion from repeats | ~ commands | ~ custom slash | ✖ | ~ | ✖ |
| Live preview of running apps in-app | ✔ Node/Python(Django/FastAPI/Flask)/custom command | ~ built-in browser | ✖ | ~ | ✔ (web preview) | ✖ |
| Built-in browser control | ✔ (8 browser tools) | ✔ Browse product | ✔ Chrome plugin | ~ | ~ | ✖ |
| Voice input | ✔ (provider ASR + live test) | ~ Hex (separate product) | ✖ | ✔ (ChatGPT voice) | ✖ | ✔ |
| Checkpoints / rewind (files+conversation) | ✔ | ✔ /undo | ~ | ✔ | ✔ | ✖ |
| Diff review before apply | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Security postures (presets, allowlist, taint scan, command guard) | ✔ | ~ permissions | ~ permissions | ~ sandbox | ~ | ✖ |
| Token economy (caching stats, ×0.1, auto-compaction) | ✔ honest usage ledger | ~ | ~ compaction | ~ | ~ | ✖ |
| Learning/DNA (what the agent learned about you) | ✔ | ✖ | ~ memory (CLAUDE.md) | ✖ | ✖ | ✔ (self-improving skills) |
| Arabic/English bilingual UI | ✔ full RTL | ✔ (i18n site) | ✖ | ✖ | ✖ | ✖ |
| Local account (optional, scrypt, 0600 files) | ✔ | ✖ (no account) | ✖ (subscription auth) | ✔ ChatGPT auth | ✔ | ✔ |
| Open source | ✖ (closed, source ships with builds) | ✔ MIT | ✖ | ✖ | ✖ | ✔ |

## 2 · What they have that SADEEM does NOT (honest gaps)

1. **Tab-style autocomplete** (Cursor) — SADEEM's editor has ghost suggestions but not Cursor-class multi-line prediction. Roadmap.
2. **PR-bot code review** (Cursor BugBot, Codex review) — SADEEM's /review runs locally on demand; it does not yet watch a remote repo and comment on PRs. Roadmap.
3. **Cloud execution** (Codex cloud tasks, Cursor background agents) — SADEEM is deliberately local-first; there is no hosted runner yet.
4. **Mobile companion** (OpenCode) — steer sessions from a phone. Not built.
5. **Free hosted models** (OpenCode free models / Go) — SADEEM uses YOUR keys; no hosted free tier today.
6. **Marketplace breadth** (Claude Code plugin marketplaces, OpenCode extensions) — SADEEM ships a starter catalog + one-click MCP registry, but the third-party ecosystem does not exist yet.
7. **macOS/Linux builds** — planned; today Windows 10/11 x64 only.
8. **LSP-grade intelligence in the editor** (Cursor/TypeScript-LSP plugins) — Monaco + codeintel only.

## 3 · What SADEEM has that they do NOT

1. **Proof-verified runs**: every run ends in an Ed25519-signed verdict with a false-done ledger and a mutation gate that demands red→green tests — "no claimed success without proof" is enforced by code, not vibes. Public verify key ships in resources/surnia-verify.pub.
2. **Arena with a merge gate**: racing models is only half of it; a challenger's diff merges ONLY if it beats the incumbent, and a failed patch keeps the winner's tree untouched (live-tested: 2 racers, honest "merge rejected").
3. **Local scheduled jobs with webhook triggers** — cron any task, trigger from anywhere.
4. **Bilingual Arabic/English desktop UI** with full RTL — none of the five competitors ship an Arabic-first interface.
5. **Token economy card** with real cache numbers (×0.1) and compaction status — the competitors hide this in logs.
6. **Security postures** in one click (Safe/Balanced/Independent) over ~10 engine keys, network allowlist, taint scan, command classifier (audited against real injection cases in tests/v72-risk).
7. **The official website is generated from the same design contract** (flat graphite/lime, zero gradients) with a local-first console.

## 4 · Positioning sentence

SADEEM competes not on having the most models or the biggest marketplace, but
on being the only workstation that **proves its work before claiming it** —
signed verdicts, gated merges, and an honest ledger of everything it did.
