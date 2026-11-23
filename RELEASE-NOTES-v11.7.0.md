# Release notes — v11.7.0 "Remote + Stream Resilience"

## 1 · SADEEM Remote — control the agent from your REAL phone (the competitor wave, matched)
Claude Code (remote control), Codex (mobile) and Cursor (iOS) all landed
phone control in 2026. SADEEM now has its own — local-first, zero cloud:

- Settings → **SADEEM Remote (Phone)**: flip one toggle, scan the QR with
  your phone (same Wi-Fi / hotspot), and the control page opens.
- From the phone: the **live transcript** (thinking · answers · every tool
  call), **send a new task** when idle, **steer** a running one, **approve /
  deny** permission requests (they resolve the desktop's own approval cards),
  and **abort**.
- Architecture: HTTP on 0.0.0.0:48888 (configurable) + 20-char pairing token
  (timing-safe, checked on every request, lives in the URL fragment), SSE
  live feed mirroring the exact desktop event stream. No relay servers, no
  cloud — everything stays on your LAN. Turn the toggle off → all access cut.

## 2 · Chat reliability — the "unexpected / never replied / weird reply" class
- **75s SSE idle watchdog** (providers layer): a provider that stops sending
  bytes without closing the connection used to hang the turn FOREVER — the
  #1 cause of "the AI doesn't reply". Now it costs one retry, then failover.
- **4-attempt turn retry** (was 2) + provider failover preserved.
- **Defensive tool dispatch**: gateways that emit tool deltas with
  finish_reason "stop" used to have their calls silently DROPPED (the model's
  tool intent vanished → weird answers). Parsed calls now execute.
- **max_tokens mid-args**: truncated tool JSON is never executed — the run
  auto-continues instead.

## 3 · The transcript tells the truth
- **claim-audit / mutation-check no longer leak raw JSON** — they render as
  verdict chips (CLAIM-AUDIT ✓/⚠ N claims · MUTATION-CHECK HONEST/FAKE/SKIP).
- **JSON-meta safety net**: any future engine payload with meta-only keys
  renders collapsed — machine JSON can never again reach user prose.
- **Status strip, Claude Code parity**: "Deep in thought…" after 45s of pure
  reasoning, `Esc to interrupt` hint, thinking detection from the live
  think_delta channel.

## 4 · Slash commands actually execute
- `/prompts /arena /git /mcp /skills /usage /library /settings` were
  registered in the composer menu but fell through to the MODEL as literal
  text when typed. They now open their panels.
- `/pr /tests /changelog /handoff /grill` show the SHORT command in the
  transcript instead of echoing the full expanded prompt.

## 5 · Prompt & capability upgrades
- **MCP orchestration** section: chain servers freely (blender-mcp → 3D
  asset → web/Unity; HF/image-gen MCP → media → the site you build next),
  sequential-by-design calls, retry-once-then-alternate policy, verify
  MCP deliverables.
- **Skills-first rule**: matching skill → use_skill before improvising.
- **Anti-limit contract**: the model never stops with "my limit" — budgets
  are the harness's job (auto-continue + compaction + failover).
- **Cost guardrail UI**: per-run spend ceiling in Settings → Agent
  ($ default 2; 0 = unlimited) — the engine already enforced it.

## Verification
| Check | Result |
| --- | --- |
| tsc --noEmit | clean |
| unit tests | 158 pass / 0 fail (1 skipped, as baseline) |
| vite build + electron build + cli build | clean |
| electron-builder no-wine patches | applied (UninstallerReader + resedit) |
| SADEEM Remote endpoints | / state · send · approve · abort · SSE |
