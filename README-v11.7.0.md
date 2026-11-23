# SADEEM v11.7.0 — "Remote + Stream Resilience"

**Release date:** 2026-11-15 · **Codename:** `Remote`

The phone wave is matched: SADEEM Remote pairs your real phone with the
desktop agent over your own Wi-Fi (QR → live transcript → send/steer →
approve → abort), with zero cloud. Under the hood this release hunts the
chat-reliability bug class the owner reported — stalled streams that never
answered, dropped tool calls, raw JSON leaking into the transcript — and
closes every hole found.

## 1 · SADEEM Remote (التحكم بالهاتف)
- Settings → SADEEM Remote (Phone) → enable → scan the QR.
- Live mirror of the desktop run: reasoning, answers, tool rows, approvals.
- Send tasks / steer mid-run / approve-deny / abort from the phone.
- LAN-only by design (0.0.0.0:48888 + pairing token; no cloud, no tunnel).
- Phone-initiated runs use the programmatic run pipeline (persisted sessions).

## 2 · Reliability fixes (the reported bug class)
| Symptom | Root cause | Fix |
| --- | --- | --- |
| "AI never replies" | provider stops SSE bytes without closing → hang forever | 75s idle watchdog → retry → failover |
| "unexpected" stream errors | only 2 turn retries | 4 retries + provider failover chain |
| tool calls ignored / weird replies | tool deltas with finish_reason "stop" dropped | defensive dispatch — parsed calls execute |
| truncated args executed | max_tokens mid-tool-JSON | never executed; auto-continue instead |
| raw JSON in chat | claim-audit / mutation-check had no renderer cards | verdict chips + JSON-meta safety net |

## 3 · UX parity with Claude Code
- "Deep in thought…" after 45s of pure reasoning (their exact behavior).
- `Esc to interrupt` on the run strip.
- Slash commands: panel commands execute; template commands show the short
  command row, not the expanded prompt.

## 4 · AI core
- MCP orchestration prompt (chain any servers; verify MCP deliverables).
- Skills-first rule; anti-limit contract; cost guardrail per run in Settings.

## Packaging
- `SADEEM-Setup-11.7.0.exe` — NSIS installer (assisted)
- `SADEEM-11.7.0-portable.exe` — single-file portable
- `SADEEM-11.7.0-win.zip` — unpacked portable folder
- exe carries the SADEEM icon + version 11.7.0.0 (pure-JS resedit, no wine)

Everything in `download/` with `SHA256SUMS-sadeem-v11.7.0.txt`.
