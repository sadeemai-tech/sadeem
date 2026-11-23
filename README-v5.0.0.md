# Surnia v5.0.0 — "Soft Modern": the trust release

**The release that makes the agent's work verifiable, its skills growable, its memory explicit, and its face calm.**

Built directly on the v3.1.0 baseline (nothing reverted — every v3/v3.1 power is intact and extended).
Method: live reverse-engineering of Google Antigravity 2.0 (docs + codelab), the ChatGPT/Codex 2026
design language, Anthropic's Nov-2026 Claude releases, and the MCP ecosystem — see
`docs/COMPETITIVE-2026-11.md` for the full study.

---

## 1. Soft Modern design (new default)

- **New `soft` theme** — calm warm-white daylight, hairline neutrals, one deep-sage accent;
  glass resolves to clean translucent panels, the aurora field is nearly silent.
- **Typography ramp fixed at the root** — body 13→14px; agent replies (markdown) 12.75→14.5px
  with 1.7 line-height (Arabic 1.85); transcript, composer, tree, tabs, statusbar chips all bumped;
  the caps-instrument voice goes sentence-case.
- Obsidian / Midnight / Paper themes remain, now with the shared larger type ramp.

## 2. Artifacts Hub — مركز الأدلة (rail 09, the headline)

Antigravity's core insight — *artifacts solve the trust gap; the agent proves it produced* —
implemented natively:

- The hub derives **proof of work** from the real session transcript: edit/command/document/MCP
  counts, files touched, the todo checklist with completion state, the agent's own verification
  screenshots, and the final walkthrough.
- **One click exports a self-contained shareable HTML proof page** into the workspace —
  bilingual chrome (EN/AR), RTL-native, zero dependencies, hostile-content-escaped.
- Pure derivation layer (`src/lib/artifacts.ts`) with unit tests.

## 3. Skills system — growable, three scopes

- **Scopes with override order**: workspace (`.surnia/skills`) → global (`<userData>/skills`) →
  **built-in library** shipped inside the app (6 professional skills: `arabic-first`,
  `web-quality`, `code-review`, `release-notes`, `python-data`, `debug-protocol`).
- **Antigravity anatomy**: SKILL.md + `scripts/ references/ assets/` companion files (surfaced to
  the agent by `use_skill`, viewable in the manager, traversal-guarded reads).
- **`create_skill` tool** — the agent saves reusable procedures itself; SKILLS index updates next run.
- **Skills manager panel (rail 08)**: search, grouped by scope, create from scratch, import a
  folder, fork a built-in to edit, delete what you own. Built-ins can never be deleted or overwritten.
- **Settings → Skills & Memory (15)**: trust gate, manager link, auto-learning toggle, global memory.

## 4. Memory you can steer

- **`remember` tool** — explicit mid-run durable memory: `project` scope writes a dated, deduped,
  capped (`## Remembered`) section into workspace MEMORY.md; `user` scope records a DNA preference.
- Existing stack intact and now fully wired in settings: auto-learning after runs (MEMORY.md
  `## Learned` + DNA extraction), cross-session `recall_memory`, global memory editor.

## 5. Universal builder — any language, provably

- **7 new scaffold templates** (12→19): `python-fastapi`, `go-cli`, `rust-cli`, `java-cli`,
  `cpp-cmake`, `csharp-cli`, `electron-ts` — real ecosystem manifests, runnable entrypoints.
- The Stack-selection protocol routes systems-language work to them (or native tooling).
- Template **filenames** now accept `{{slug}}`/`{{name}}` placeholders.
- 7-test harness locks every template end-to-end (files, manifests, substitutions).

## 6. Autonomy with a straight face

- `fullAccess` (the FULL chip) now carries **deeper continuation budgets** (≥60 rounds vs 30) and
  **2× subagent depth** — hands-off runs actually finish hands-off.
- Always-allow rules, doom-loop guard, protected-path hard guard unchanged.

## 7. MCP gallery refresh

10 → **17 curated one-click presets**: GitHub, PostgreSQL, Puppeteer, Slack, Firebase, Supabase,
Docker join the core set. Persistent pooled clients, per-tool enable/disable, prompts/resources,
stderr health — all from v3.1 — unchanged.

## 8. Desktop assistant

The device toolset (screen capture with vision, clipboard read/write, OS notifications,
open paths/URLs, reveal in folder, trash, process list/kill, make_document) is now surfaced with
**assistant starter prompts** ("What is on my screen right now?", "Draft a one-page project report (PDF)").

## 9. Tests & build status

- `node --test tests/*.test.mjs` → **48/48 pass** (v3.1's 26 + v5's 22: scaffold 7, skills 7,
  memory 4, artifacts 4).
- `tsc` clean on both projects; full production build green (vite + CSP post-build + preload).
- Built-in skills ship via post-build (`dist-electron/skills/`, lands in the packaged asar).

## Honest note (unchanged doctrine)

The ceiling is still the model you connect — but v5 makes everything around the model
trustworthy: you can SEE what it did (Artifacts), TEACH it how you work (Skills + memory), and
LET it run (autonomy budgets) — in an interface that finally feels calm.
