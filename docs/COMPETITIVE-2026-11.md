# Competitive reverse-engineering — November 2026

Research basis for the Surnia v5.0.0 release. Sources were read live during the
v5 build (Google Antigravity docs + codelab, Anthropic release notes, OpenAI
GPT‑6/Intelligent UI announcement, Product Hunt category data). This document
records what each competitor actually does internally, what Surnia v5 adopted,
and what it deliberately did not.

---

## 1. Google Antigravity (deep dive — the primary blueprint)

Antigravity 2.0 is no longer "an Agent Manager bolted to an IDE" — it is a
standalone agent command center (plus IDE/CLI/SDK/editor-extensions products).
The mechanisms that matter, verified against the official docs and codelab:

| Mechanism | How Antigravity does it | Surnia v5 adoption |
| --- | --- | --- |
| **Projects** | A project = one or more folders + isolated per-project agent settings (security preset, artifact-review policy, allowed paths/URLs, per-project MCP allowlists) inherited from global settings | Surnia workspaces + per-workspace `.surnia` policy/permissions (v2.5) already cover this; per-project MCP allowlists exist as per-tool deny rules |
| **Artifacts** | The trust mechanism: Task Lists, Implementation Plans (via `/plan`), Walkthroughs, code diffs, screenshots, browser recordings — "artifacts solve the trust gap; the agent produces an artifact to prove it". An Auxiliary Pane toggles them | **Artifacts Hub (rail 09)** derives the same proof set from the real transcript (plan checklist, files touched, command count, agent screenshots, final walkthrough) and exports a self-contained shareable HTML proof page — bilingual/RTL |
| **Skills** | Directory packages: `SKILL.md` (frontmatter name/description + body) + optional `scripts/ references/ assets/`. Global scope `~/.gemini/config/skills/`, project scope `.agents/skills/`. **Progressive disclosure**: only metadata loads at start; the body loads on demand when the request matches | Surnia v5 skills use the same anatomy and scope semantics (workspace `.surnia/skills` → global `<userData>/skills` → built-in library shipped with the app), progressive disclosure via the SKILLS index + `use_skill`, plus `create_skill` so the agent grows the library itself |
| **Scheduling** | `/schedule` + a Schedule UI: recurring tasks and one-time reminders per project, enable/disable | ScheduleService + Flows/Schedule panel (v2.6) — parity |
| **MCP** | Local + remote servers, one-click gallery (Google Cloud-heavy), config file, per-tool enable/disable toggles, whole-server switches | MCP+ registry with persistent pooled clients (v3.1), per-tool enable/disable, prompts/resources; gallery refreshed to 17 presets (GitHub, Postgres, Slack, Firebase, Supabase, Docker, Puppeteer added in v5) |
| **Browser verification** | Chrome debugging sessions, browser recordings, before/after screenshots | Surnia drives its own preview (static + dev servers), `preview_screenshot` gives the agent vision, `ui_quality_check` probes 390/820/1366px. A recording-less pipeline, but agent-eyes-closed problems are solved |
| **Voice mode** | New Gemini Live voice input | Not adopted in v5 — quality bar (Arabic STT quality) is higher than what we can ship confidently offline; revisit |

**What Antigravity does that we deliberately skipped in v5:** multi-folder
projects (single-root keeps our permission model honest), Google-account
auth/quotas, browser *recording* video artifacts.

## 2. OpenAI Codex / ChatGPT (design language + product shape)

- The ChatGPT desktop app's 2026 redesign: sidebar separated from chat
  history, calmer surfaces, soft rounded geometry, near-monochrome palette
  with one accent, generous whitespace, larger reading type. GPT‑6's
  "Intelligent UI" pushes interactive components (buttons/forms/charts)
  inside chat answers — structured chat cards are now table stakes.
- **Surnia v5 adoption:** the new default **Soft** theme (calm warm-white,
  hairline neutrals, deep-sage accent, flat "glass resolves to a panel"),
  body font 13→14px with a proper reading ramp (markdown replies 12.75→14.5px,
  Arabic line-height 1.85), sentence-case voice replacing caps-instrument
  labels, structured in-chat cards already present (plan card, ask_user
  choice buttons, skill cards).

## 3. Claude Code / Claude Desktop (Anthropic)

- Verified from Anthropic's release notes (Nov 2026): Enterprise security
  center + admin API, Personal Finance beta, **Claude Duet** (proactive agent
  app, Oct 21 research preview), **Claude Cowork** merged into every
  conversation, Claude Design/Slides/Docs as in-conversation artifacts,
  plugins directory with analytics. Claude Code itself: repo-scale terminal
  agent; three quiet safety/controllability releases in early Nov 2026.
- **Takeaways adopted in v5:** artifacts-in-conversation (Artifacts Hub),
  proactive-assistant framing (device assistant powers + assistant starter
  prompts), skills/plugins as first-class user-visible objects.

## 4. Cursor / Windsurf / Kilo Code / Lovable (the fast lane)

- Product Hunt's 2026 AI-coding-agents category: Cursor (editor-native),
  Claude Code (terminal/repo-scale), Lovable (MVP app builder) lead the
  three lanes. Windsurf remains the reference "acquired product" case study
  (acquired by Cognition after the OpenAI deal collapsed in 2025).
- **Takeaways:** Cursor's tab-completion/inline-edit polish is out of scope
  for v5 (ghost text exists); Lovable's one-click deploy is a v6 candidate.

## 5. The two fuzzy names from the original request

- **"New competitor launched ~2 days ago"**: no single coding-agent launch in
  the Nov 4–8 2026 window could be confirmed with a name matching the
  description. The closest major events in the window were Anthropic's
  Claude Code safety releases (Nov 5–6) and enterprise admin features.
  Candidates considered and ruled out: IBM Bob (enterprise agent, older),
  "One" (agent question inbox, Oct 6), Coforge Autonomous Software Factory
  (enterprise service, not a product). If the user remembers the name, a
  follow-up mini-review is cheap to add.
- **"زيكو" (described as a product of an acquired company)**: could not be
  confirmed in either Arabic or Latin sources as an AI coding product.
  Phonetically closest real products: **Kilo Code** (open-source VS Code
  agent) and **Zed** (editor). The "acquired company" description best fits
  **Windsurf (by Cognition)**. Covered all three above so the analysis is
  complete either way. Marked unconfirmed rather than guessed.

## 6. What v5 ships because of this research (summary)

1. Artifacts Hub — Antigravity-grade proof of work, shareable, RTL-native.
2. Skills system — same anatomy/scopes as Antigravity + self-growing
   (`create_skill`) + 6-skill built-in library.
3. Soft modern design — ChatGPT/Codex 2026 design language as the default.
4. Universal-builder hardening — 19 scaffold templates across 7 language
   families, stack protocol routes to them, machine-capability probing.
5. MCP gallery refresh — 17 curated servers with per-tool toggles.
6. Memory — explicit `remember` tool + auto-learning + global/project/DNA layers.
7. Full-autonomy headroom — fullAccess runs get deeper continuation budgets.
