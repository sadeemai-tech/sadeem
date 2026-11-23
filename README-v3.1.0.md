# Surnia v3.1.0 — "Universal Builder": the agent that can program anything, on your machine

**The release that answers: "why does my agent answer ما بعرف / I can't while Claude Code programs anything?" — and removes every structural cause we could find, then adds the missing powers.**

Built directly on the v3.0.0 baseline (nothing reverted — every v3 power is intact and extended).
Method: full codebase read + reverse-engineering of Claude Code (v2.1.319 prompt/toolset/permissions research), OpenAI Codex CLI (protocol/sandbox/apply-patch research), Cursor (run-modes/rules/checkpoints research), OpenCode (server/agents/permissions research) and the current MCP specification (2025-06-18 era). Every mechanism below traces to one of those studies or to a confirmed bug in v3.

---

## 1. Never "I can't" — the universal capability contract

The one-file-HTML default died in v3; v3.1 kills the remaining *refusal* causes at the root:

- **Capability contract rewritten** (`# Capability contract (read this first)`): the model is now told — in plain terms — that it can program LITERALLY ANYTHING in any language/framework (web, backend, desktop, mobile, systems, CLIs, physics, parsers, documents, images) **and** that it is a general desktop assistant (files anywhere, apps, clipboard, screen, web research).
- **`# Machine capabilities` prompt section (new)**: before every run the engine probes the machine (node, npm, pnpm/yarn/bun, python, pip, poetry, git, docker, cargo, go, java, dotnet — 5-min cache) and injects the result. The model no longer *guesses* what exists; the prompt adds the rule: *missing runtime ≠ blocker — install it (winget/choco/brew/apt/pip/npm) and continue.*
- **Refusal recovery v2** (engine): the old nudge fired only when a run ended with refusal language AND zero tool calls. Now:
  - **mid-task refusals** ("I can't find X so I can't proceed" after a few reads, no writes) also trigger a corrective nudge (install the toolchain / take the best approach) — up to 2 per run;
  - the nudge now carries the machine-capability facts and lists install commands.
- **max_tokens auto-continue (new)**: a run that hits the output cap mid-answer used to just *stop* (it looked like giving up). The engine now continues automatically — up to 3 "[continued — output limit reached]" rounds with an exact continuation instruction.
- **Default output budget doubled→smart**: `maxTokens` default was a hard 8192 (truncating long agentic answers). It now derives from the model catalog's `maxOut` (capped 32k), else 16384.

## 2. New universal-builder tools (51 → 57 core tools)

- **`make_document`** — REAL documents in one call: **PDF** (rendered through a hidden print window — full CSS, webfonts, **Arabic/RTL**; professional A4 stylesheet for markdown input incl. tables/code/quotes; `contentIsHtml:true` for total styling control), **DOCX** and **XLSX** generated *natively* (zero dependencies — a minimal OOXML writer ships in the app: `ziplite.ts`), plus html/md/csv/txt. Offline CLI fallback: a dependency-free text-PDF renderer (`minipdf.ts`). The prompt's Stack table now routes every document request to it — no more "write a Python script" indirection (that path still exists for advanced cases).
- **`multi_edit`** — several exact string replacements on one file, validated against a rolling buffer first, ONE approval with the full diff, ONE atomic write (the Claude Code MultiEdit pattern).
- **`move_path`** — rename/move files & folders (cross-volume EXDEV fallback), overwrite guard.
- **`delete_path`** — delete with the OS **trash** by default (recoverable), `trash:false` for permanent; protected-path hard guard (system roots, `/usr`-class dirs, drive roots, home, workspace root) + the usual `delete` approval.
- **`reveal_in_folder`** — show any file in Explorer/Finder/Files (shell.showItemInFolder).
- **`ask_user`** — structured clarifying question with **choice buttons** (+ optional free-text) rendered in a dedicated chat card; answers flow back as the tool result. Used only when the answer changes what gets built — the prompt forbids delegating decisions the agent should make.
- **`run_command` gained `cwd`** — run in any directory (shown in the approval dialog).

## 3. Desktop-assistant powers (device bridge v2)

- `revealInFolder`, `trashItem`, **`clipboardImage`** (an image on the clipboard is returned to the agent's *vision* as a data URL — "what's in this screenshot I copied" now works), and **`printToPdf`** (hidden offscreen window → real PDFs) are all wired into the tool layer via the existing `DeviceImpl` bridge.
- Free-season paywall noise removed: the 14-day trial no longer auto-starts on first open, and while the gateway is offline every license reads as **Pro** — no countdown, no "expired" demotion (billingService gates were already open; the *perception* of a premature paywall is gone too).

## 4. MCP that actually works (v2 client → 2025-spec client)

Reverse-engineered against the MCP spec + Claude Desktop/Cline behavior; the v3.0 client had **three fatal flaws** (remote servers never reached the model, stateless per-call respawn, POSIX-only spawning):

- **FIX: remote servers now reach the agent** — discovery filtered on `s.command` only, so http/sse servers were invisible to the model. Now `command || url`.
- **Persistent client pool** — one live connection per server (idle TTL 5 min, LRU cap 8, config-fingerprint respawn, shared in-flight handshakes, one fresh-spawn retry on failure). Stateful servers (memory graph, playwright browser, DB sessions) keep their state; no more npx cold start on every call. `closeAllMcpClients()` wired into app quit.
- **Windows works**: `npx`/`uvx`-class commands spawn through `cmd.exe /d /s /c` (the `.cmd` shim / EINVAL fix).
- **Protocol modernization**: initialize negotiates **2025-06-18** (accepts older), `MCP-Protocol-Version` header on http, tools/list **pagination** (nextCursor loop), server `ping` answered, `notifications/tools/list_changed` honored (annotation cache invalidated + re-probe), per-call progress tokens captured.
- **`prompts/get` implemented** — server prompt templates render to text in the panel (with arg inputs + copy).
- **Single approval gate** — the duplicate native dialog for destructive tools is gone; the engine gate (with per-tool always/deny rules) is the one gate; a panel-remembered DENY refuses locally.
- **Health monitor costs 100× less**: the 60s tick pings the live pooled connection instead of a full connect+3-lists+kill probe per server every minute. Plus an 8KB **stderr tail** per server surfaced in the panel.
- **Registry refreshed** to the current ecosystem (filesystem, memory, sequential-thinking, everything, fetch, git, time, `@playwright/mcp`, official brave-search, sqlite via uvx) with `${workspace}` cwd hints; call counters moved out of settings.json into `mcp-stats.json` (fixes a settings-clobbering race).
- **Subagents get MCP tools now** (same approval gate) — specialists are no longer weaker than the main agent.

## 5. Streaming that feels native (chat panel)

Measured problem: one IPC send + one full store clone + one app-wide re-render + a full markdown re-highlight **per token**. Now:

- **Main-side coalescing**: consecutive `text_delta`s flush at most every **33ms** as one event; structural events (tool_start/result/message_end/turn_end) always flush pending text first — ordering can never be wrong.
- **Renderer rAF ingest**: text deltas buffer into a pending batch flushed once per animation frame (with a hidden-window watchdog), so a token storm costs ONE state update and ONE commit.
- **Markdown pipeline fix**: while streaming, code blocks render plain (no highlight.js re-run per token, no whole-tree walk for the copy button); full highlighting applies once at message end. The streaming row carries `msg-streaming` for the new "alive" styling.
- **Steer no longer splits the answer**: mid-stream steered messages no longer break the streaming bubble (the ingest walks back over steer/queued rows to the streaming assistant message).
- **Perf hygiene**: persistSession no longer reloads the sessions list each save (local patch); usageLog disk writes batched (10s + flush on turn end); auto-scroll runs in rAF only when pinned; `aria-live` token spam replaced by a completed-turn status announcer; long chats render the last 100 messages with a "Load earlier messages" chip.

## 6. Preview shows anything

- **Universal artifact preview**: the static server now accepts single **PDF / image / video / audio / markdown / text / json / code** files and serves a generated viewer page (dark chrome, `__surnia/view` + `__surnia/raw` routes, nosniff, traversal-guarded). Markdown gets a real inline renderer (escape-first, never executes file HTML); code gets lightweight highlight. `detectTargets` now surfaces the 6 most recent artifacts (reports/ docs/ dist/ out/ assets/ exports/) in the target selector.
- **Agent servers in the panel**: localhost URLs harvested from the agent's background processes appear as "Agent:" chips.
- **Blank-page diagnosis**: a dismissible hint overlay explains the classic blank causes (not built / dev server starting / needs a server) instead of a silent white rectangle.
- **Vision/quality bug fixes**: the console-error collector never fired on Electron 33 (event-object signature) — `ui_quality_check` console errors and screenshot counts now actually populate; screenshots wait for `document.fonts.ready` + rAFs instead of a blind 700ms; contrast findings are skipped when the background is a gradient/image (no more phantom "low contrast").

## 7. Design polish (SURVEYOR doctrine kept: no gradients, no purple, tokens only)

Fixed: faux-bold weights (550/620/650 → static ladder), focus ring no longer destroys keycap/glass shadows (additive outline system), dead `--red` token → `--bad`, spec-ring animates 3 iterations instead of forever.
Elevated: streaming row accent rail + tail fade-in, tool-card entrance choreography with tabular-numeral durations and stamp status, skeleton shimmer on tree/sessions/DNA/flows loads, composer focus glow, context-meter warn/critical tint + pulse, active-tab accent lip, toast stack physics, hero-grid empty states with kbd hints, welcome hero entrance, theme-correct accent swatches, z-plane tokens.

## 8. Tests & build status

- `node --test tests/*.test.mjs` → **26/26 pass** (hooks 9 + v3 harness 6 + **new v3.1 harness 11**: tool defs, make_document md/html/csv/docx/xlsx/pdf end-to-end + containment, multi_edit atomicity, move/delete + protected-path refusals, ask_user paths, prompt sections, engine recovery wiring).
- `node tests/v2-verify.mjs` → **42/42 checks pass** (ROOT de-hardcoded — derived from file location now).
- `tsc` clean on both projects; `npm run build` (tsc → vite → post-build CSP → preload esbuild) green; `cli:build` green.

**Honest note (unchanged from v3):** the ceiling is still the model you connect — but v3.1 removes every *harness-side* reason for "I can't": the model now knows the machine, gets corrected when it refuses mid-task, continues past output caps, holds warm MCP connections, can generate real documents, organize real files, and ask one structured question instead of stalling.
