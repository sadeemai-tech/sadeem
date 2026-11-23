# FEATURES — Surnia v2.3.0 «يستمع إليك»

Full changelog for v2.3.0. Every item ships in the release build and is covered
by `tests/v23-smoke.ts` (21 checks, all green) or the 9-test suite.

## A. Anti-refusal AI core (the headline fix)

1. **Capability contract** — a word-stable `# Capability contract` system-prompt
   section: the agent declares full tool access, is forbidden from "I can't /
   I don't have the tools", and must act first.
2. **Refusal auto-recovery** — a run that ENDS with refusal language (EN + AR
   regex, `\b`-free for Arabic) and ZERO executed tools gets a corrective
   system nudge listing real capabilities + the user's ask, then continues.
   Max 2 recoveries per run; subagent turns exempt.
3. **```surnia-tool text protocol** — for providers with broken/missing native
   function calling (custom endpoints, OpenRouter `:free`, Ollama): the model
   can emit fenced JSON tool calls in plain text; the engine parses them,
   executes them exactly like native calls, and strips the blocks from the
   visible transcript. Enabled per-provider (custom/openrouter/ollama).
4. **General-assistant declaration** — the agent is explicitly a desktop
   assistant too (files, documents, system questions, web research), not only
   a coder.

## B. Machine-wide read access

5. Reads (`read_file`, `list_dir`, `search_files`, `glob_files`, `read_image`,
   `code_search`) work ANYWHERE on disk with no per-path approval — parity with
   Cursor / Claude Code / Codex.
6. **`fs_browse` tool** — no-arg machine overview (Windows drives + home
   special folders) or an annotated tree of any directory (depth ≤ 3, sizes).
7. **`workspace_map` tool** — one-call project map: manifests, npm scripts,
   key deps, compact tree (Aider-style repo map, dependency-free).
8. **Secret masking** — `.env` / keys / credentials outside the workspace are
   value-masked (structure preserved, secret-ish keys only); unmasking is the
   ONE remaining escape approval.
9. Writes/commands containment and all permission modes unchanged.

## C. DNA — advisory, never blocking

10. DNA prompt section rebuilt: explicit ADVISORY header ("never rules, never
    bans; the user's current request always overrides"), dislikes framed as
    default-only, feedback rendered as single events.
11. Denial capture reworked: only explicit COMMAND denials record (writes
    never), approval timeouts never record, max 1 per run, advisory wording.
12. Auto-extraction can no longer INVENT dislikes — only explicit user words.
13. Per-entry forget button for feedback rows in the DNA panel.

## D. Streaming UX

14. Live run pill: current activity (reading/writing/command/thinking/MCP…),
    elapsed, tool count, tokens — above the composer.
15. Glass tool cards: per-tool icons, smart arg summary, live state chip,
    duration, +N/−N diffstat, scanning bar, auto-open drawer on error.
16. Thinking block v2: live-expanded, auto-collapse, "Thought for Ns".
17. Smart auto-scroll: 120px stick threshold, detached "+N" jump pill,
    reduce-motion aware; streaming fence-balancing fixes code flash.

## E. Liquid Glass v6

18. Glass levels off/soft/medium/strong (root `data-glass`), full token
    retunes per theme; `prefers-reduced-transparency` forces off.
19. Ambient aurora layer (3 drifting blobs, ≤9% alpha, GPU transform).
20. Glass extended to cards, panels, modals, palettes, menus, tool timeline.
21. Accent tint (sage/teal/clay/amber) × 3 themes; transcript width
    cozy/wide/full; motion speed 0.5–1.5×; all in Appearance settings.

## F. Settings reorganization

22. Appearance split into Theme & Glass / Typography / Layout & Density /
    Motion, with per-section reset and bilingual registry entries.

## G. Free season

23. `FREE_SEASON = true` in billingService: every gate open (device, parallel,
    subagents, MCP, no daily cap); plans keep Pro/Team visible but
    `available: false` → "PAUSED" chips, struck prices, disabled checkout.
24. Plans screen: below-titlebar overlay (window X always reachable), fixed
    close button, Esc + backdrop close, free-season banner.

## H. New capabilities

25. **Voice input** — MediaRecorder mic in the composer; transcription via the
    active OpenAI-compatible provider (`/audio/transcriptions`, whisper-1)
    routed through the main process; graceful failure toast.
26. **Session HTML export** — standalone share file (inline CSS, RTL text /
    LTR code, save dialog defaults to Downloads).
27. **"Surnia: Explain selection"** — editor context-menu action +
    Ctrl/Cmd+Shift+E; sends the selection to chat with an Arabic wrapper when
    the UI is Arabic.
28. Full AR translations for every new string (67 keys) + registry keywords.
