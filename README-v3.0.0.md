# Surnia v3.0.0 — "Powerhouse": the agent gets its missing powers

**The release that answers one question: "why does the AI build garbage single-file sites while Claude Code programs anything?" — and fixes it at the root.**

Root cause found and removed: the v2.6 system prompt literally instructed the model
*"DEFAULT SHAPE: ONE self-contained index.html … Reach for React/Next/Vite ONLY when
the user asks"*. The app was telling the model to think small. v3 inverts the rule.

---

## 1. Stack-Matching protocol (the headline)

The `# Web craft` prompt section is replaced by **`# Stack selection & build protocol`**:

- **You are not limited to any language or framework — and you must NOT dumb work down.**
  A single `index.html` is right ONLY for a small static page, never a shortcut for an app.
- The model now picks the toolchain like a senior engineer:
  - Web **app** (state/routing/auth) → `scaffold_project "react-vite"` / `"nextjs"` → npm install → background dev server → verify
  - Landing / portfolio / dashboard → `static-site` / `web-portfolio` / `web-dashboard`
  - REST/GraphQL API → `node-api` · CLI → `node-cli-ts` / `python-cli` · Data/automation → `python-data`
  - **Browser game → `game-web` (Three.js) · Desktop game → `game-python` (pygame)** · Mobile → Expo · Desktop → Electron/Tauri
  - **PDF / DOCX / XLSX → write and RUN a script (reportlab / python-docx / openpyxl) and verify the file**
- If the user names a stack, it is used. Otherwise the model decides and says why in one line.

## 2. `scaffold_project` — the template registry becomes an agent tool

The 10 production templates were locked inside the New-Project wizard while the prompt
told the model to "scaffold from template" — with no tool to do it. Now the model can:

    scaffold_project { template: "nextjs", name: "my-shop" }

- 12 templates (2 new): `game-web` — a real Three.js game shell (delta-time loop, WASD +
  touch controls, score/pause/restart, zero build step) and `game-python` — a pygame
  desktop game (class-based loop, spawning, difficulty ramp, restart).
- Write-wall enforced: the created folder must live inside the workspace; one approval
  shows the template, file count and exact target before anything is written.
- The result teaches the next steps (install → run_background → preview → screenshot).

## 3. `run_background` / `process_output` / `stop_process` — give the agent time

`run_command` blocks (≤600s) — a dev server would always die. The new background
service (new `electron/services/processService.ts`) starts long-lived processes that
**survive across turns**:

- returns an id immediately; `process_output` reads NEW output since the last read,
  reports running/exited + exit code, and **harvests localhost URLs** the server printed;
- `stop_process` kills the whole process group; output is kept in a bounded ring AND a
  log file under `userData/process-logs/`;
- caps: 8 concurrent, 6h age ceiling, and **everything the agent started is killed when
  the app quits** (`will-quit` hook in main.ts);
- SECURITY: the exact same gauntlet as `run_command` — destructive-command guard on the
  raw string, `.surnia/policy.json` deny, risk classification with danger forcing an
  approval even in fullAccess.

## 4. `preview_screenshot` — the agent finally SEES its work

- Captures any page (an `.html` file, a folder with `index.html`, or the running
  **localhost dev server**) in an offscreen window at a chosen viewport and returns the
  PNG **as a vision image** the model itself looks at (same `{ok, dataUrl}` contract as
  `read_image`), with an optional workspace PNG copy.
- `ui_quality_check` now accepts localhost too (v2.6 blocked it — probing your own dev
  server is the entire point). Other private ranges stay blocked unless fullAccess.
- The finishing loop is now: **preview → ui_quality_check until PASS → screenshot and
  LOOK → fix → re-shoot.** A UI the agent has not seen is not done.

## 5. `task(background: true)` — fire-and-forget subagents

The background-subagent host that existed in the engine is now wired to the task tool:
launch a specialist that keeps running while the main agent continues; the result
arrives as a `background_done` message. Parallel-safe set extended with `process_output`.

## 6. Design integrity (small, surgical)

- `--bg2` was declared **twice per theme** (a dead literal shadowed by the alias) — the
  dead literal is gone in all three themes with a comment explaining why; **rendered
  values unchanged**.
- New drift-guard test pins `styles.css` ↔ `THEME_META` hexes and the single-`--bg2`
  invariant, so a future "harmless cleanup" cannot silently recolor the app.
- Terminal palette re-tints on **accent** changes too (was theme-only → stale cursor/
  selection colors after switching accent until reload).
- i18n: bilingual tool-card labels for the five new tools; icons + verb colors + smart
  arg summaries (template/id/action) in the chat tool cards.

## 7. Test & build status

- `node --test tests/*.test.mjs` → **15/15 pass** (hooks 9 + new `v3-harness.test.mjs` 6:
  tool defs, background lifecycle + URL harvest, scaffold e2e for game-python & nextjs,
  Stack-Matching prompt assertions, theme drift guard).
- `node tests/v2-verify.mjs` → **42/42 checks pass** (stale `/home/z/my-project/kodex`
  ROOT paths fixed in `v2-verify.mjs` + `e2e.mjs`; `scaffold.e2e.cjs` expects 12 templates).
- `tsc` clean on both projects; `npm run build` + `cli:build` green; NSIS no-wine patch
  re-applied; `Surnia Setup 3.0.0.exe` + `Surnia-3.0.0-win.zip` produced on Linux.

---

**Honest note:** the remaining hard cap is the model you connect. With Claude/GPT/Gemini
through your API the agent now has Claude-Code-class powers (files, shell, background
processes, scaffolding, vision, subagents, MCP). A weak free model will still produce
weaker results — but it now has the same hands.
