# Surnia vs. the field — capability comparison (November 2026)

Researched from primary sources (official docs/changelogs/registries — see RESEARCH-2026-11.md). ✓ = shipped · ◐ = partial · ✗ = not present.

| Capability | **Surnia 2.1** | Claude Code 2.1 | Codex CLI 0.166 | Cursor 3.27 | OpenCode V2 | Zed 1.27 | Devin Desktop 3.11 | Hermes Agent |
|---|---|---|---|---|---|---|---|---|
| Plan mode with structured approval options | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |
| Steer (inject at tool boundary without abort) | ✓ | ✗/◐ | ✗ | ✓ | ✗ | ✓ | ◐ | ✗ |
| Message queue during run | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Doom-loop / repetition guard | ✓ | ◐ | ✗ | ✗ | ✓ (doom_loop) | ✗ | ✗ | ✗ |
| Command risk classifier (static, local) | ✓ | ◐ (auto mode LLM) | ✓ (execpolicy Starlark) | ✗ | ◐ (wildcards) | ◐ | ✓ | ◐ |
| Auto-verify loop after edits (build/test + self-repair) | ✓ | ◐ (hooks) | ◐ | ◐ | ✗ | ✗ | ◐ | ✗ |
| Structured review w/ severity findings | ✓ | ✓ (/review, Bugbot cloud) | ✓ (/review) | ✓ (Bugbot) | ◐ | ◐ | ✓ (Quick Review) | ✗ |
| Debug task mode (instrument→reproduce→fix) | ✓ | ◐ | ◐ | ✓ (Debug Mode) | ✗ | ✗ | ✗ | ✗ |
| Skill factory (agent writes its own SKILL.md after goals) | ✓ | ◐ (skills, manual authoring) | ◐ (skills) | ◐ | ◐ | ◐ | ◐ | ✓ (signature) |
| Auto-memory + learning nudges | ✓ | ✓ | ✓ (2-phase pipeline) | ✗ | ✗ | ✗ | ✓ (Memories) | ✓ (signature) |
| Session recap export | ✓ | ◐ (export) | ✓ (/recap) | ✗ | ◐ (export) | ✗ | ✗ | ◐ |
| Background subagents + progress events | ✓ | ✓ | ✓ | ✓ (cloud) | ✓ | ✓ (parallel) | ✓ | ✓ |
| MCP client w/ health monitoring | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tool annotations surfaced (RO/DANGER/IDEM) | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ✗ |
| Tool-poisoning scanner + quarantine | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ (sandbox) |
| Official MCP registry search & add | ✓ | ◐ (marketplaces) | ✗ | ◐ (marketplace) | ✗ | ✗ | ✗ | ◐ (plugins) |
| Per-tool enable/disable + call log | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Terminal command guard (interactive PTY) | ✓ | ✗ (agent-path only) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| OS-level sandbox (Seatbelt/bwrap/AppContainer) | ✗ | ✓ | ✓ | ✓ (cloud) | ✗ | ✓ | ✓ | ✓ (backends) |
| Secret redaction in logs + UI events | ✓ | ◐ | ✓ | ◐ | ◐ | ✗ | ◐ | ◐ |
| Append-only audit trail w/ viewer | ✓ | ◐ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ |
| FS symlink escape walls + .surniaignore | ✓ | ◐ | ✓ | ✗ | ◐ | ◐ | ◐ | ✗ |
| Data controls (clear/export ZIP, keys stripped) | ✓ | ◐ | ✗ | ◐ | ◐ | ✗ | ◐ | ◐ |
| Multi-provider catalog (12 groups, 68 models, Nov-2026) | ✓ | ✗ (1 family) | ◐ (OpenAI+OSS) | ✗ (in-house+BYO) | ✓ (45+ via models.dev) | ◐ (BYO) | ✓ | ✓ (300+ via portal) |
| Checkpoints / rewind | ✓ | ✓ | ✓ (fork) | ✓ | ✓ (snapshots) | ✗ | ✓ | ✗ |
| Git worktrees integration | ✓ | ✓ (desktop) | ✓ | ✓ | ✓ | ✓ (threads) | ✓ | ✗ |
| Scheduled jobs / automation | ✓ | ✓ (routines) | ◐ | ✓ (Automations) | ◐ (/schedule) | ✗ | ◐ | ✓ (NL cron) |
| Live preview + console capture | ✓ | ◐ (Chrome) | ✗ | ✓ (browser) | ◐ (artifacts) | ✗ | ✓ (Previews) | ✗ |
| AI commit messages matching repo style | ✓ | ◐ | ◐ | ◐ | ✗ | ✓ | ✓ | ✗ |
| Local control API (headless) | ✓ | ✓ (SDK) | ✓ (exec-server) | ✓ (SDK) | ✓ (server) | ✗ | ◐ | ✓ (gateway) |
| Voice input | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| Cloud execution fleet | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| Tab autocomplete (in-editor) | ◐ (ghost text) | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ |
| Works fully offline / local models | ◐ | ✗ | ◐ | ✗ | ✓ (Ollama) | ◐ (local Zeta) | ✗ | ✓ |

## Where Surnia leads
1. **Safety without an OS sandbox dependency** — the terminal guard + danger gate + audit trail run identically on Windows/macOS/Linux from one Electron process; competitors split this across OS-specific sandboxes.
2. **MCP as a first-class citizen** — health monitoring, annotations, anti-poisoning quarantine, official registry, per-tool control and call logs in one surface; every competitor does a subset.
3. **The learning loop** — skill factory + memory nudges + style-matched commits = the agent compounds value in YOUR repo (the Hermes insight, integrated into a coding workstation).
4. **Design language** — SURVEYOR v4 (numbered instrument grammar, condensed caps, stamps, keylines) is deliberately unlike any competitor's VS Code fork or TUI.

## Where competitors lead (honest ledger — next rounds)
- OS-level sandboxing (Codex's bwrap/seccomp, Zed default-on) → Surnia roadmap: Windows AppContainer profile for agent shells.
- Cloud fleets (Claude/Codex/Cursor/Devin) → local-first is a product decision; a "cloud session" adapter can ride the local API.
- Tab autocomplete depth (Cursor portals, Zeta2) → ghost text exists; a local small-model predictor is the next step.
- Voice input (Codex/Cursor/Devin/Hermes).

---

# v7.1.0 update — the trust column (Nov 2026)

| Capability | Surnia 7.1 | Claude Code | Codex CLI | Cursor | VS Code agents |
|---|---|---|---|---|---|
| **False-Done Rate published** (claimed-success runs overruled by gates) | ✓ (metric + UI + ledger) | ✗ | ✗ | ✗ | ✗ (docs say the judge is not proof of correctness) |
| **Mutation gate on the changed lines** inside the agent loop | ✓ (kill-rate verdict + survivors fed back, always-restore) | ✗ (external tools like Tautest) | ✗ | ✗ | ✗ |
| **Deterministic fake-test detector** (zero model: tautologies/skips/empty/swallowed/mock-only) | ✓ runs before the critic | ✗ | ✗ | ✗ | ✗ |
| **Harness-enforced red→green** (failing run recorded BEFORE passing, from the ledger) | ✓ | ◐ (directive only) | ✗ | ✗ | ✗ |
| **Signed re-runnable proof package** + CLI re-verify (`surnia verify --rerun`) + PR-ready markdown | ✓ (HMAC + sha256 fingerprints + drift detection) | ✗ | ✗ | ✗ | ✗ |
| **DAP debugger for the agent** (breakpoints/step/evaluate, root-cause evidence) | ✓ (debugpy + js-debug, one-click) | ✗ (self-claimed absent Aug-2026) | ✗ | ✗ | ✗ ( Kimchi first; supporting capability here) |
| **Taint-aware approvals** (web/MCP/repo/skill content escalates dangerous commands even in fullAccess) | ✓ (ledger + source cards) | ✗ | ✗ | ✗ | ✗ |
| **Verification budget immune to 429/5xx** (retryable deaths refunded, never consumed) | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Arena with objective scores + verified merge** (tests+mutations+lint+diff-fit; hunk/file merge re-tested, kept only if ≥ best single) | ✓ (parallel, isolated ports+DB+env per attempt) | ◐ (best-of-N exists) | ◐ | ✓ (2–10 tries, judge + manual merge) | ✓ (judge; merge left to manual review) |
| **Real OS isolation** (docker one-shot / WSL / Windows Sandbox, fail-closed) | ✓ | ✓ (bwrap/seccomp) | ✓ | ◐ | ◐ |
| **MCP OAuth** (RFC 8414 + dynamic registration + PKCE + safeStorage + refresh) | ✓ | ◐ | ◐ | ◐ | ◐ |
| **Cost per PROVEN change per model + strict task budget** | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Scheduler with proof gate** (file-watch/webhook/ci-failure triggers; only verified runs notify) | ✓ | ◐ | ✓ (Automations) | ✓ (Automations) | ✗ |

Honest gaps that remain (still true): cloud execution fleets, tab-autocomplete depth, voice input. The v7.1 release claims NO parity additions — every row above is a trust/verification row, which is the market gap nobody else closes.
