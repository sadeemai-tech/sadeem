# Kodex — Roadmap

Indicative plan. Scope per release may shift; items move down, not up. The "Honest notes" column states dependencies, risks, and what an item does *not* cover.

## v1.1 — Power & Automation

| Feature | Description | Honest notes |
|---|---|---|
| Hooks system | User-defined reactions to engine lifecycle events (pre/post tool use, turn end) | Requires a stable event naming contract first; badly written hooks can slow or break every turn — needs timeouts and dry-run validation |
| Plan mode gate | A mode where the agent drafts a plan and blocks execution until the user approves it | Adds a fourth permission mode alongside Ask / Auto-edit / Full access; plan quality depends on the model, not on Kodex |
| Custom slash commands | Project-local commands defined in `.kodex/commands` (markdown prompts) | Straightforward; file format must be documented and versioned, and collisions with built-in commands need defined precedence |
| Worktree isolation | Run the agent in a dedicated git worktree so the main checkout stays clean | Git-only benefit; requires git installed and confuses beginners without clear UI; checkpoint restore across worktrees needs care |
| Headless CLI | `kodex exec --json`: run agent turns from a script or CI and consume the event stream as JSON | Reuses the main-process engine outside Electron; no UI affordances (approvals must be pre-granted via flags); free-plan gate must be defined for non-interactive use |

## v1.2 — Context Intelligence

| Feature | Description | Honest notes |
|---|---|---|
| LSP diagnostics into context | Feed compiler/linter errors from language servers into the agent loop so it can self-correct | LSP startup cost per language; noisy diagnostics can pollute context — needs filtering and rate limits |
| Repo map | Compact ranked representation of the repository (symbols, structure) injected into context, Aider-style | Gains are largest in big codebases; tuning map size vs. token cost is empirical work |
| Voice input | Dictate prompts into the chat panel | Input only, not output; OS speech APIs vary per platform; accessibility benefit is real but usage is niche |

## v2 — Scale

| Feature | Description | Honest notes |
|---|---|---|
| Agent teams | Multiple cooperating agents with role division (planner / coder / reviewer) | Multiplies token cost and failure modes; orchestration UX (who did what) must be solved before this is useful |
| Cloud tasks | Delegate long-running tasks to hosted runners, pick up results in the desktop app | Requires server infrastructure, sandboxing, and a billing story — conflicts with the local-first promise unless strictly opt-in |
| Plugin marketplace | Distributable UI + tool extensions with review and signing | Trust and review burden is the real cost; marketplace economics only make sense after a stable plugin API ships in 1.x |
