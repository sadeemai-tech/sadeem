# Surnia v7.0.0 — "Deep Engineer" (harness-integrity release)

Built **directly on the user's v6.0.0 base** (the newest version by timestamp — not by version number). Every change below is implemented and tested; the verification method is listed per feature. Nothing here is "designed but not wired".

## The 16-point audit — what was done

| # | Audit point | What v7 does | Proof |
|---|---|---|---|
| 1 | Code understanding (no LSP/index/repo map) | **codeintel**: incremental multi-language symbol index (TS/JS/PY/GO/Rust/Java/C-family…), new tools `find_refs`, `symbol_outline`, `impact_of`, `repo_map`; **impact auto-injection** after every edit (blast radius appears in the tool result without being asked); orientation protocol in the system prompt | 14/14 unit tests + eval T6 |
| 2 | Fragile edit_file | **Tolerant edit engine**: exact → whitespace-normalized → fingerprint fuzzy matching; indentation reconstruction; CRLF preserved; **harness-enforced read-before-edit + staleness detection** (edit without read is rejected by the runtime, not the prompt); **syntax probe before save** (JSON hard-fail, `node --check`, Python `ast`, balance analysis); multi_edit stays atomic | 9/9 unit tests + eval T1–T3 + real E2E |
| 3 | Context economy | Compaction triggers at **65% of the model's REAL window** using the provider's actual input-token count (the old 120k-chars bug is dead — regression-tested for 1M windows); **pinned structured summaries** (goal + plan + task mode are NEVER summarized away); **tool-result pruning with `recall_result(id)`** (nothing deleted, everything retrievable); **log shaping** (errors grouped, head/tail, full text in the vault); **rolling Anthropic cache breakpoint** (history prefix cached, ~10% read cost) | eval T4 (18 checks) + T5 (20 checks) |
| 4 | Verifier not independent | Goal-verifier AND critic now run on a **different provider family** (router picks any configured non-worker vendor); `verifierMode: fail-closed` option treats a broken verifier as NOT-verified; **mutation check** (flips one line, runs the suite — tests that still pass are exposed as fake); **claim→evidence audit** (English + Arabic verbs: عدّلت/شغّلت/أصلحت…) flags unevidenced claims in the receipt; **red→green directive** for bug fixes | verification tests 10/10 + visible in real E2E run |
| 5 | Multi-model orchestration | **Router**: per-role models (plan/search/edit/verify) in Settings → Agent; family profiles (GLM/DeepSeek get strict-JSON coaching); **mid-run failover** to the next configured provider with full state; **best_of_n** tool: N isolated worktree attempts, composite-score winner (tests + diff size), only the winner merges | router module + UI card + E2E loop unchanged |
| 6 | Planning/debugging | Steps carry **testable acceptance criteria** ("→ accept: …"); **stagnation detector** (K turns without NEW evidence → forced strategy change, bounded, then user escalation); enforced **debug protocol** in the prompt (reproduce → hypotheses → real tools → fix → regression) | engine + prompts |
| 7 | Memory & learning | **memory_verify**: facts tagged `[src: path]` are re-validated against source-file mtimes — stale facts are flagged, not trusted; failure memory stays in DNA; skills self-refine from denial sessions (v6, kept) | tool + tests |
| 8 | Security | **Obfuscation layer** in the risk classifier: inline interpreters (`python -c`, `node -e`, `pwsh -enc`), encoded payloads (danger), variable-indirection commands (warn), destructive-pattern-inside-interpreter escalation; **network allowlist** (`settings.agent.networkAllowlist`) enforced in `http_request` | risk module + allowlist UI |
| 9 | Robustness across models | **Malformed tool-call repair** (smart quotes, trailing commas, truncated JSON — repaired before the step counts as failed); **tool-result shaping**; per-family prompt profiles | repair unit path + shaping tests |
| 10 | Measurement | **Trace recorder** (JSONL per run in userData/traces) + **offline eval harness** `node scripts/eval-harness.mjs` (6 graded tasks, regression gate) + **failureStats()** aggregation | 6/6 gate green |
| 11 | Interaction | **Question calibration** rule in the system prompt (ask only for irreversible/ambiguous-changing-what); **Arabic-first**: dialect understanding, Arabic comments/identifiers allowed, RTL verification demanded of the agent itself | prompts (bilingual rules) |
| 12 | Product discipline | **Brand unification**: `window.surnia` primary bridge (legacy `window.kodex` alias kept), `surnia.cjs` CLI, `.surnia/` dirs, Surnia git identity; docs numbers corrected in this README; runAgent still large — the context/verification blocks were extracted into modules (`contextStore`, `verification`, `editEngine`, `codeintel`, `router`), full split is staged for v7.1 (honest note) | 0 brand remnants outside the documented alias |

## Also in v7 (from the standing requirement list)

- **GitHub PR path**: `create_pull_request` + `pr_status` tools (gh CLI).
- **6 new MCP presets**, endpoints live-probed: Figma (stdio), Vercel (https://mcp.vercel.com), Linear (https://mcp.linear.app/mcp), Cloudflare (https://bindings.mcp.cloudflare.com/mcp), Notion (official npm + remote), GitHub-remote (https://api.githubcopilot.com/mcp/).
- **Design fixes you demanded**: the colored left/right stripe on messages is **gone** (chat.css), the **title bar is de-cramped** (44px, 40×40px window controls, elastic spacer, RTL-safe), settings got the **router card + allowlist + verifier posture**, and the **status bar shows a live `ctx %` / `cache %` chip**.
- **License honesty**: the local HMAC license is not treated as revenue protection (documented; FREE_SEASON opens everything).

## Verification summary (all run in this workspace)

- `node --test tests/*.test.mjs` → **98/98 pass**
- `node scripts/eval-harness.mjs` → **6/6 gate GREEN** (T1 edit-tolerance, T2 read-before-edit, T3 syntax-gate, T4 context-math, T5 pruning+recall, T6 repo-map)
- **Real E2E** (real engine + real GLM-4.6 through the local bridge): `tests/e2e.mjs` → **10/10 passed** (bugfix, plan mode, subagents; the red→green directive fired in a live run).
- `tests/long-task.e2e.mjs` → 5/8 under sustained provider 429 storms (build succeeded, 10 tests written, but the run ended with failing tests + a wrong redirect status). Honest reading: when the shared SDK rate-limits for 30–60s per retry, the turn budget dies before final verification. The end-of-run receipt correctly reports `verifyFailed: true`. Targeted for v7.1: verify-rounds budget must exclude rate-limit wait time.
- 17 screenshots in `shots/` (welcome/chat/skills/MCP/settings incl. the v7 router card, dark themes, AR + EN) — captured from the real app under Xvfb and reviewed by the agent itself.

## Known limitations (stated, not hidden)

- OS-level sandbox isolation (Docker/WSL/AppContainer) is **not** implemented in v7 — the hardening shipped is classifier + allowlist + policy layers. This is the biggest remaining gap for "safe long autonomy".
- MCP OAuth (authorization-code + PKCE for remote servers) is not in v7; the remote presets exist and the client speaks HTTP/SSE, but token entry is manual.
- Remote/mobile control stays loopback-only in v7.
- LSP integration: v7 ships the symbol index + diagnostics-probe approach, not a full LSP client.

## Build

```
npm install
npm run full        # typecheck + build + preload + CLI
npm test            # 98 tests
node scripts/eval-harness.mjs
npm run dist:win    # Windows NSIS + zip (Windows host)
```
