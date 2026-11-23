# SADEEM v11.8.0 — Deep Space Console

**Release date:** 2026-11-15
**Artifacts:** `SADEEM-Setup-11.8.0.exe` (NSIS installer) · `SADEEM-11.8.0-portable.exe` · `SADEEM-11.8.0-win.zip`
**Baseline:** v11.7.0 "Remote + Stream Resilience" — every v11.7 capability carries forward unchanged.

---

## 1 · The agent console, rebuilt (the headline change)

The transcript was re-engineered from a stack of boxed cards into a **Claude-Code-class phase timeline**:

- **THINK / WORK / BUILD / RUN / PROVE phases** render on a slim left time-rail: one colored node per phase, a quiet caps header (localized EN/AR, live duration, item count) — no more nested boxes.
- **Live streaming reasoning you can actually read.** The instant-collapse bug is dead: while the model thinks, a dedicated violet panel streams the reasoning in italic with a seconds ticker and a breathing caret, tail-pinned auto-scroll (with jump-to-live). When the turn finishes it collapses to one refined row — *"Thought for 12s"* + a faint first-line peek — expandable at any time, with a copy-reasoning chip.
- **Tool calls are one-line verdict rows.** Verb-coded icon (READ / EDIT / SEARCH / RUN / PLAN / WEB / BROWSER / MCP), the primary argument as text (file basename, command, query, URL — `dir="ltr"`, ellipsis, full value on hover), diffstat when relevant, and a single status chip (`OK 512ms` / `ERROR` / `DENIED`). **The raw-JSON `ARGUMENTS` dump is gone** — expanding a row reveals a structured pretty-args list (small-caps keys, paths with copy buttons, typed values, clamped long text) instead of JSON.
- **Results render inline**: first 6 lines in a soft code pre, "N more lines" expands, errors tinted, exit-code metadata kept.
- **User messages are unmistakable**: right-aligned (RTL-mirrored) accent-tinted bubble with a YOU header, 85% max width.
- **Assistant rows are turn-grouped**: the `SADEEM · time` header appears once per turn; model stamp moved into the hover actions; markdown body enlarged to 14.5px/1.7.

## 2 · Deep Space design system

- **obsidian (default) retuned**: true deep-space canvas `#0A0E14`, cooler recessed wells, cards `#131A23`, hairlines visible but quiet, text ladder re-graded for contrast (`--dim` ≥ 7:1 on canvas), accent refined to `#98D83B` with dark ink on fills.
- **Real layered shadows**: two-layer ambient card shadow + a deep float shadow for modals (neutral black only — no colored glows).
- **New welcome hero**: logo plate, display heading, three premium starter cards with accent icon tiles and hover lift, Connect-an-AI-model / Security-level panels in the same voice, honest empty states.
- **Shell polish**: consistent 40px title bar, rail active pill with accent notch, quieter status bar, slimmer scrollbars.
- **midnight / carbon / light / high themes re-graded in the same language**; theme swatch metadata synced (drift-guard test updated and passing).

## 3 · REA — Reverse Engineer Anything (new built-in skill)

The REA skill (`reverse-engineer-anything`, upstream v62 from `morluto/rea`) ships as a built-in skill inside the app (workspace `.surnia/skills` and global scopes still override it). It gives the agent a proven methodology for reverse engineering native, managed, Electron/JS, packaged and browser targets — exactly what SADEEM itself was built by.

## 4 · Carried from v11.7.0 (unchanged, verified)

- **Chat reliability**: 75s SSE idle watchdog, 4-attempt turn retry with provider failover, defensive tool dispatch, `max_tokens` truncation guard.
- **UI truth**: claim-audit / mutation-check verdict chips + renderer-side JSON safety net.
- **Slash commands execute locally** (`/prompts` `/arena` `/git` `/mcp` `/skills` `/usage` `/library` `/settings`…), short display for `/pr` `/tests` `/grill`.
- **SADEEM Remote**: real-phone control over LAN/hotspot (QR pairing, live transcript mirror, send/steer, approvals, abort — zero cloud).
- **Claude Code parity strip**: "Deep in thought…" after 45s, Esc-to-interrupt hint.
- **MCP orchestration + skills-first prompt contract**; per-run cost guardrail in Settings → Agent.

## 5 · Verification performed on this release

- `tsc --noEmit` clean; full production build (vite + post-build + electron + cli) clean.
- 158/158 unit tests pass (theme drift guard updated to the new palette).
- Live-app screenshots under Xvfb: workspace + seeded conversation (top & bottom of transcript) + welcome hero + auth gate — all verified visually.
- Windows artifacts: `pe-library` metadata check (ProductName/SADEEM, FileVersion 11.8.0), 7-layer icon present, zip integrity tested (74 entries, no corruption), REA skill confirmed inside `app.asar`.

## 6 · Honest scope notes

- The console redesign touches presentation only — store, engine, provider and tool pipelines are untouched, so all v11.7 behavior contracts hold.
- The new pretty-args drawer covers the standard tool arg shapes (paths, commands, queries, URLs, todos, diffs); exotic MCP server arg shapes fall back to the generic typed renderer.
- Styles.css keeps the legacy `.band*` rules (inert; the new grammar is `sc18-*`).
