# FEATURES — Surnia v2.4.0 «المسارات الذكية»

Full changelog for v2.4.0. Every item ships in the release build; each entry
below cites the source file that implements it. Headliners: **Liquid Glass v7**
(the full visual identity redesign), the **permanent removal of the paywall
gate**, and **Flows — المسارات الذكية** (repeated prompts become one-click
flows).

## A. Liquid Glass v7 — full visual identity redesign

1. **`src/assets/glass-v7.css` (531 lines)** — a new design core imported as the
   FIRST line of `styles.css`, so every rule is unlayered and out-ranks Tailwind
   layers; `styles.css` re-maps its legacy tokens/aliases onto the v7 ladder
   (radii, fonts, glass fills), while edge, aurora, `--sh1..--sh4` depth and the
   blur steps stay canonical in glass-v7.
2. **Local font bundle** (`src/assets/fonts/`) — Geist 400/500/600/700 +
   GeistMono 400 for Latin/code, IBM Plex Sans Arabic 400/500/600/700 for
   Arabic UI text, Noto Kufi Arabic 700 for Arabic display type. All `woff2`,
   all shipped with the app — no font CDNs.
3. **Concentric radius ladder** — `--r-xs 6 / --r-sm 10 / --r-md 16 / --r-lg 24
   / --r-xl 32` (+ pill); child radius = parent radius − padding, and
   `styles.css` maps its old `--r-*` aliases onto the ladder.
4. **Specular conic borders (`.spec-ring`)** — a masked 1px conic-gradient ring
   (`--edge-hi` highlight + accent stop) that slowly rotates (8s) around chrome
   surfaces; disabled cleanly under `html[data-specular='off']`.
5. **Grain** — a `.grain` utility (SVG `feTurbulence` noise, ~5% overlay blend)
   plus ~2.8% grain baked into `.glass-strong`/`.glass-menu` so deep frost
   reads as material, not flat blur.
6. **Aurora v2** — the ambient field behind the window is a single drifting gradient field (v2.4.1 perf contract: no filter blur — survives software compositors).
   blurred blobs counter-drifting on `body::before`/`body::after`
   (`styles.css`), with `--aurora-a/b/c` cores bled toward the live theme
   accents (glass-v7.css).
7. **Glass material classes upgraded** — `.glass` / `.glass-strong` /
   `.glass-chrome` / `.glass-dock` / `.glass-strip` / `.glass-menu`: low-blur
   chrome vs deep-blur floats, each with tuned fill, edge and grain.
8. **Scroll-edge fade** — a functional, bg-toned transparency mask at list
   edges (`styles.css`), so content dissolves under chrome instead of clipping.
9. **Spring micro-interactions** — `.press`, `.lift`, `.msg-in`,
   `.anim-glass-pop` driven by `--ease-glass: cubic-bezier(0.32, 0.72, 0, 1)`;
   all gated behind `[data-motion]` with plain fallbacks.
10. **Per-theme adaptation** — `obsidian` (default warm dark), `midnight`
    (Flexoki Ink) and `light` (Warm Paper) each remap edge heat, aurora dose
    and accent mixes (`themeMeta.ts` + `html[data-theme=…]` blocks).
11. **Full degradation chain** — every effect drops out under
    `data-glass="off"`, `html[data-specular="off"]`,
    `prefers-reduced-motion` and `prefers-reduced-transparency`.
12. **New setting: `specularEdges`** — Appearance toggle (default on);
    `ui.specularEdges` in `shared/types.ts`, rendered in
    `AppearanceSection.tsx`, applied as `html[data-specular]` by `App.tsx`.

## B. The paywall is gone — forever

13. **Daily-gate removal** — the hidden free-plan daily gate that silently
    swallowed chat messages and popped the payments page is REMOVED from
    `sendMessage` in `src/store.ts` (the site is marked with a v2.4 comment).
    No code path can swallow a message or interrupt a chat with billing again.
14. **`FREE_SEASON = true`** in `electron/services/billingService.ts` keeps
    every main-process gate open (device control, parallel subagents, MCP,
    runs); the paid-gate logic below it is dormant. The app is free — no
    mid-chat interruption is possible.

## C. Free-season billing UI

15. **PlansScreen v4** (`src/components/PlansScreen.tsx`) — rebuilt around a
    glass hero with the **FREE SEASON** badge and a **share button** that
    copies the download link ("Link copied" feedback). Pro/Team stay visible
    as "currently paused": struck (`line-through`) prices, paused note,
    **zero checkout wiring** — paused buttons only reveal an inline note.
16. **Plans overlay hygiene** — the overlay sits at `z-[80]` (above the diff
    modal at z-75) and starts below the title bar, so the window X is always
    on top with a 32px hit area; **Esc** closes, **backdrop click** closes;
    layout works maximized and in RTL.
17. **Consistent free-season identity** — `billingShared.tsx` owns the glass
    `FreeSeasonBadge`, reused by `UsagePanel` and `BillingSection`;
    the StatusBar paywall chip became a neutral **FREE SEASON** chip that
    shows today's run count.

## D. Flows — المسارات الذكية (flagship)

18. **`electron/services/flowsService.ts`** — named, reusable prompts.
    Self-registers its six IPC channels (`kdx:flows:list/save/delete/markRun/
    hit/info`) without touching `ipc.ts`; owner-only 0600 files, atomic
    tmp+rename writes; every function is defensive — a flows failure can
    never break a run or the app.
19. **Repetition → suggestion** — a normalized repetition counter
    (`kdx:flows:hit`, 80-char compare) watches what you type; at **≥3
    repeats** the chat raises a "Turn this into a flow?" chip
    (`ChatPanel.tsx` `FlowSuggest`). One click saves it. The suggestion fires
    once, then gently re-pings every 5th repeat.
20. **FlowsPanel (rail 07)** — cards with name, prompt preview, scope chip,
    `runCount` + `lastRun`, and Run / edit / delete. **Run** sends the prompt
    through the normal chat path and calls `flowsMarkRun` (optimistic run-count
    bumps in the UI).
21. **Entry points** — rail item **07**, a command-palette entry
    (`CommandPalette.tsx`), and the **`/flows`** slash command; all open the
    panel (`store.ts` widens `RailView` with `flows`).
22. **Two scopes, hard caps** — global flows in `<userData>/flows.json`
    (userData is pinned to `<appData>/Surnia`) and workspace flows in
    `<ws>/.surnia/flows.json`; caps **50 global / 20 workspace**, hits pruned
    to the 200 most recent. Types `Flow` / `FlowsInfo` in `shared/types.ts`.

## E. Project rules files

23. **Auto-loaded rules** — `<ws>/AGENTS.md`, `<ws>/CLAUDE.md` and
    `<ws>/.surnia/rules/*.md` (sorted by filename) are collected at
    system-prompt build time (`collectProjectRules` in
    `electron/agent/prompts.ts`) and injected as a **PROJECT RULES** section:
    "follow unless they conflict with safety or the user's current request".
24. **Capped and cached** — 4,000 chars per rule file, 16,000 chars for the
    section; per-workspace cache keyed on file mtimes (30s) so a turn never
    re-reads unchanged files. Missing files → the section is omitted entirely
    (zero overhead, prompt cache stays stable); unreadable files are skipped,
    never fatal.

## F. Command policy file

25. **`<ws>/.surnia/policy.json`** — optional per-project policy with
    `deny`/`allow` glob patterns (compiled `*`→`.*`, case-insensitive) plus
    plain-English `instructions` that are injected into the system prompt
    ("--- command policy (.surnia/policy.json) ---"). Cached like rules;
    malformed JSON warns and is ignored.
26. **Enforced pre-approval (layer 1b)** — in `run_command`
    (`electron/agent/tools.ts`) a **deny** hit hard-blocks the command BEFORE
    any approval is shown; deny wins when both lists match. **Allow** patterns
    pre-approve a command only in fullAccess mode — and never for
    danger-class commands (forced approval stays).

## G. AI commit message + PR description

27. **GitPanel generation** (`src/components/panels/GitPanel.tsx`) — two
    one-shot actions, **commit message** and **PR description**, built from a
    single diff collection (staged + unstaged, 8k-char cap) and sent through
    `api.aiComplete` — the dual-form one-shot IPC that resolves through the
    active provider, so it works with custom and OpenRouter providers too.
    The result is inserted into the commit box; nothing is ever
    auto-committed. (`kdx:git:commitMessage` in `ipc.ts` wires the
    main-process `gitService.generateCommitMessage` path as well.)

## H. New slash commands

28. **`/pr`** — draft a PR title + description from current uncommitted
    changes (Title / Summary / Changes / Testing notes). **`/changelog`** —
    release notes from the last 20 commits, grouped Added/Changed/Fixed.
    **`/tests [file]`** — write focused unit tests for a file (or the most
    test-worthy recent change) in the project's own style, then run them.
    **`/flows`** — open the Flows panel. The first three expand to rich
    prompts that ride the normal send path (`store.ts`).

## I. RTL-native chat

29. **`dir="auto"` everywhere** — every message body, thinking block (peek +
    body), error, approval card and todo line in `MessageView.tsx` inherits
    direction from its content, per-line. Code, `pre`, `kbd` and `.font-code`
    stay isolated **LTR** (`styles.css`).
30. **Arabic typography** — `html[lang='ar'] .msg-body` gets line-height 1.8;
    the app-wide Arabic font stack is IBM Plex Sans Arabic
    (`--font-app-ar`), with zero letter-spacing for Arabic script and Noto
    Kufi Arabic on the display layer.

## J. Resizable sidebar + rail polish

31. **Resizable left sidebar** — drag handle on the inline-end edge
    (RTL-aware), clamped **240–520px**, persisted as `settings.ui.sidebarWidth`;
    **double-click resets**; per-view wider defaults (workspace **380**, all
    others **320**), with no-overlap guarantees
    (`src/components/Sidebar.tsx`).
32. **Rail active indicator** — now a **sliding glass pill** measured against
    the view cluster via refs and springing on `--ease-glass`, with an accent
    dot; rail tooltips are glass-grain chips carrying the mono index
    (`src/components/Rail.tsx`).

## K. Capability contract & plumbing

33. **General-assistant scope strengthened** — the capability contract in
    `electron/agent/prompts.ts` now spells it out: research any topic on the
    live web, write documents, emails and translations, plan projects and
    trips, automate file organization, summarize PDFs and websites.
34. **`aiComplete` one-shot IPC** — `kdx:ai:complete` accepts the legacy
    full-params object OR a `(prompt, opts)` one-shot that throws on provider
    failure (the flows/panels contract). **Nine new IPC channels** in v2.4:
    `kdx:ai:complete`, `kdx:agent:slashCommands`, `kdx:git:commitMessage`,
    and the six `kdx:flows:*` channels. New types: `AiCompleteParams`,
    `AiCompleteResult`, `Flow`, `FlowsInfo` (`shared/types.ts`).
35. **Settings additions** — Appearance gained the specular-edges toggle
    (item 12); the Agent section gained a project-rules info card explaining
    `.surnia/rules/`, `AGENTS.md` and `CLAUDE.md` (`AgentSection.tsx`).
