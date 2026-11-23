# SADEEM v11.9.0 — "Nothing silent, nothing fake"

**Release date:** 2026-11-15
**Baseline:** v11.8.0 "Deep Space Console" — every v11.8 capability carries forward unchanged.
**Method:** full codebase audit by 3 exploration agents (engine/streaming · transcript/display · IPC/buttons), then fixes by 5 dedicated agents (engine reliability · renderer store · transcript display · wiring/panels · AI capability), then integration + verification by the release engineer.

---

## 1 · Engine streaming reliability — 19 fixes (the "weird replies / unexpected" class)

| # | Fix |
|---|---|
| E1 | No more duplicated reasoning after provider failover — the think-only guard now checks whether the DEAD attempt streamed thinking (before `closeThinking()` wiped the flag). |
| E2 | Subagent / non-stream retries no longer duplicate partial text — the dead attempt's accumulator is reset on every retry & failover. |
| E3 | Anthropic **`pause_turn` handled** (was silently treated as a finished answer): auto-continues; `refusal` surfaces a friendly error instead of a fake end. |
| E4 | The goal verifier's protocol lines (`GOAL_VERIFIED…`) and its tool cards no longer stream into your chat — verifier runs non-streaming. |
| E5 | `GOAL_COMPLETE` markers are stripped from the answer (engine + renderer). |
| E6 | Unparseable ```surnia-tool fences are ALWAYS stripped from visible text (dropped fences now logged, never silent). |
| E7 | OpenAI gateways that stream parallel tool calls WITHOUT an `index` no longer merge all calls into one malformed blob. |
| E8 | Temp-id vs final-id duplicate tool calls pruned — a truncated partial can never be dispatched alongside its complete twin (no more bogus "malformed JSON" self-errors). |
| E9 | Unsigned thinking blocks are never resent to Anthropic (they poisoned the tool loop with 400s). |
| E10 | `content_filter` finish reason is surfaced honestly + retried via failover — censored output never poses as a complete reply. |
| E11 | cli.ts env chain restored (`SURNIA_HOME || KODEX_HOME || ~/.surnia`). |
| E12 | skillGate dead ternary removed. |
| E13 | Key-required fail-fast extended to xai / moonshot / qwen / mistral (no more raw 401s). |
| E14 | Every best-effort catch (verify / compaction / critic / mutation / UI-quality) now emits a deduped low-noise notice — failures are never invisible. |
| E15 | A failed turn reports its OWN partial usage (provider snapshot or honest estimate) — no stale/zero spend in `message_end`. |
| E16 | The unapplied-code nudge no longer fires for pure Q&A (question heuristic EN/AR) — no more spurious `DONE` after an explanation. |
| E17 | Provider failover moved inside the iteration — provider failures no longer consume the step budget. |
| E18 | `thinkMs` emitted on `message_end` (real thinking duration, consumed by the UI). |
| E19 | Unknown slash commands never reach the model as literal text — a friendly local notice fires instead (custom command files still expand). |

## 2 · Renderer store — the "blinking cursor forever" class

- `streaming:true` is cleared on **every** finalized row (not just the last) — steer/queued flows can no longer leave a live-looking bubble forever.
- Reloaded sessions are sanitized — a historical row never renders as "live".
- Persistence strips torn streams; post-steer content opens a NEW assistant bubble.
- `thinkMs` persisted → real "Thought for Ns" durations survive reload.
- 🔴 **MCP elicitation approval cards are now answerable** — Allow/Deny resolves the actual `pendingElicitations` registry (was a silent no-op; the server always got the 5-minute timeout decline).

## 3 · Transcript display — 15 fixes

- Thinking ticker measures THINKING only (collapses the moment the answer starts, not at turn end); historical rows show real durations via `thinkMs`.
- PROVE detection is one grammar (`PROVE_ROW_MODELS` shared) — gate/meta cards land in PROVE bands, not THINK.
- Orphan tool results render (window-truncation dropped them before); `.sc18-solo-res` branch is reachable.
- Phase strip: no stale elapsed flash; subscribes to message changes (≤1 frame lag).
- Autoscroll follows thinking growth; the detached "new lines" counter counts both channels.
- browser_* tools got real icons (no more Wrench fallback); `process_output` verb unified to RUN.
- **34 missing i18n keys added (EN+AR)** — the English UI no longer shows Arabic fallback text in audit/mutation/redgreen/fakes/taint/proof cards; `{n}` interpolation fixed.
- Theme-safe diff colors via CSS vars in ALL 5 themes (light theme's invisible del-tint fixed with a muted rust); RTL physical padding → logical; Space-key on all expandable rows; legacy `.band*` / `.tl2-dur` dead CSS removed; "N more lines" off-by-one + soft fade mask; EOF thinking fence recognized.

## 4 · Wiring & panels — every control does something real

- **Custom slash commands** (`~/.surnia/commands/*.md`, workspace scope) now appear in the composer menu ("Custom commands / أوامر مخصصة") with source stamp; `/handoff` and `/grill` registered in the menu.
- **Agent browser dock** — new tab in the preview area: live URL/title, last screenshot via `kdx:browser:event`, status dot, Refresh / Open externally / Close. Honest empty states; read-only by design (the agent drives the browser with its tools).
- **Library "Clear all"** wired (confirm → registry wipe, honest confirm text).
- Zero-width space removed from the MCP OAuth discovery URL (the primary RFC-8414 probe could never match).
- Skills panel shows the actual workspace/global skill roots.

## 5 · AI capability — the arsenal grows 83 → 87 real tools

- **`desktop_control`** — OS-level desktop automation on the user's real desktop: click/double-click/type/key/scroll via PowerShell user32+SendKeys (Windows) or xdotool (Linux); screen-bounds checked; approval-gated like `run_command` with taint escalation.
- **`browser_wait_for`** — wait for selector/text/time in the agent browser (30s cap).
- **`browser_select`** — select dropdown options (value → label → case-insensitive), honest errors listing available options.
- **`media_ffmpeg`** — probe/convert/extract_audio/make_gif via real ffmpeg/ffprobe (execFile argv, workspace-confined, honest "not installed" error).
- **`env_probe`** — now reports ffmpeg/ffprobe/xdotool/desktop-session availability so the model knows which tools will work.
- Prompt contract: "ACT, DO NOT DESCRIBE" + end-to-end tool chaining + "NO FORCED TEMPLATES" (answers are never squeezed into a fixed structure).

## 6 · Verification performed on this release

- `tsc --noEmit` clean on **both** configs (app + electron — the electron config now passes too; 5 latent v11.8 type errors fixed on integration).
- Tests: **176 pass / 0 fail / 1 skip** (baseline 158 — 18 new engine tests added in `tests/v119-engine.test.mjs`).
- Full production build (vite + post-build + electron + cli) clean; built-in skills (9) + webcraft kit shipped into the asar.
- Windows artifacts: PE version strings verified (`ProductName=SADEEM`, `FileVersion=11.9.0`, copyright, 7+ layer icons), zip integrity 74 entries / no corruption, asar contains REA skill + all 4 new tools + `11.9.0`.
- Live boot smoke under Xvfb in EN and AR: auth gate → main workspace shell → agent console all render; no renderer errors in logs; screenshots captured (welcome + workspace).

## 7 · Honest scope notes

- `desktop_control` on macOS refuses honestly (Windows/Linux implemented); headless machines report "no display" instead of pretending.
- `browser_wait_for` polls through the existing CDP eval channel (semantics equal to waitForSelector/waitForFunction).
- The browser dock is read-only — `browserService` intentionally exposes no UI-navigate path; the agent's browser_* tools remain the driver.
- Elicitation free-text answers ride as best-effort `{text}` content (the card UI currently emits allow/deny/always/never for that kind).
