# Release Notes — Surnia v2.4.0 «المسارات الذكية»

Codename: **«المسارات الذكية» (smart paths)** · dated as shipped with
`package.json` 2.4.0. Full feature changelog: [FEATURES-v2.4.md](FEATURES-v2.4.md).

## Added

- **Liquid Glass v7** — full visual identity redesign: `src/assets/glass-v7.css`
  (531 lines) as the unlayered design core; concentric radius ladder
  (6/10/16/24/32); specular conic `.spec-ring` borders; SVG grain (`.grain` +
  baked frost noise); aurora v2 (two counter-drifting blobs behind the window);
  six glass material classes (`.glass`/`.glass-strong`/`.glass-chrome`/
  `.glass-dock`/`.glass-strip`/`.glass-menu`); scroll-edge fades; spring
  micro-interactions (`.press`/`.lift`/`.msg-in`/`.anim-glass-pop`); per-theme
  adaptation for obsidian/midnight/light; full degradation under reduced
  motion/transparency and glass/specular off.
- **Bundled local fonts** — Geist 400–700, GeistMono 400, IBM Plex Sans Arabic
  400–700, Noto Kufi Arabic 700 (`src/assets/fonts/`, woff2).
- **New setting** — Appearance → "Specular glass edges" (`ui.specularEdges`,
  applied as `html[data-specular]`).
- **Flows — المسارات الذكية** — `electron/services/flowsService.ts` +
  `FlowsPanel` (rail 07) + command-palette entry + `/flows` slash. Repeated
  requests (≥3, normalized, 80-char compare) raise a "Turn this into a flow?"
  chip in chat; one click saves it. One-click runs with run counts. Global
  (`<userData>/flows.json`) + workspace (`<ws>/.surnia/flows.json`) scopes;
  caps 50/20. Six `kdx:flows:*` IPC channels; `Flow`/`FlowsInfo` types.
- **Project rules files** — `<ws>/AGENTS.md`, `<ws>/CLAUDE.md` and
  `<ws>/.surnia/rules/*.md` auto-loaded into every run's system prompt as the
  PROJECT RULES section (`collectProjectRules` in `electron/agent/prompts.ts`;
  4k chars/file, 16k total, 30s mtime cache).
- **Command policy file** — `<ws>/.surnia/policy.json` with deny/allow glob
  patterns + plain-English instructions (injected into the prompt); deny
  hard-blocks pre-approval (layer 1b in `run_command`), allow pre-approves
  only in fullAccess and never for danger-class commands
  (`electron/agent/tools.ts`).
- **AI commit message + PR description** in GitPanel — one-shot generation
  from the working diff via `api.aiComplete` (works with custom/OpenRouter
  providers); results are inserted, never auto-committed.
- **New slash commands** — `/pr`, `/changelog`, `/tests [file]`, `/flows`.
- **`aiComplete` one-shot IPC** — dual form (legacy object params or
  `(prompt, opts)` that throws on failure); nine new IPC channels in total
  (`kdx:ai:complete`, `kdx:agent:slashCommands`, `kdx:git:commitMessage`,
  six `kdx:flows:*`).
- **Agent settings** — project-rules info card in the Agent section.

## Fixed

- **Paywall bug killed forever** — the hidden free-plan daily gate that
  silently swallowed chat messages and popped the payments page is removed
  from `sendMessage` (`src/store.ts`); `FREE_SEASON = true`
  (`electron/services/billingService.ts`) keeps every main-process gate open.
  No mid-chat interruption is possible.
- **Plans overlay reachability** — PlansScreen rebuilt: overlay at `z-80`
  below the title bar, window X always on top with a 32px hit area, Esc +
  backdrop close, works maximized and in RTL.
- **RTL chat correctness** — `dir="auto"` on every message/thinking/error/
  approval/todo line; code blocks isolated LTR; Arabic line-height 1.8 with
  the IBM Plex Sans Arabic stack applied app-wide via `html[lang=ar]`.
- **Sidebar ergonomics** — resizable 240–520px (RTL-aware handle), width
  persisted (`ui.sidebarWidth`), double-click reset, wider per-view defaults
  (workspace 380, others 320), no-overlap guarantees.

## Changed

- **Free-season billing UI** — PlansScreen leads with a glass hero, FREE
  SEASON badge and share button (copies download link); Pro/Team shown as
  "currently paused" with struck prices and no checkout wiring;
  `FreeSeasonBadge` (`billingShared.tsx`) unifies UsagePanel/BillingSection;
  StatusBar paywall chip → neutral "FREE SEASON" chip with today's run count.
- **Capability contract strengthened** — the general-assistant declaration now
  explicitly covers web research, writing (documents/emails/translations),
  planning, file-organization automation, and summarization of PDFs/websites
  (`electron/agent/prompts.ts`).
- **Rail polish** — active view indicator is a sliding glass pill (measured,
  spring on `--ease-glass`); tooltips are glass-grain chips; rail gains item
  07 (Flows).
- **Default sidebar widths** widened (380 workspace / 320 others) and the
  width is user-resizable and persisted.
