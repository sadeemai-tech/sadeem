# Surnia v2.6.0 — Design Integrity & Real Build Capability

**Surnia v2.6.0 — the release that makes Arabic/RTL correct everywhere, keeps the app alive on weak GPUs, and gives the agent real capabilities to build with**

---

## ✨ Highlights

- **The RTL/Arabic design regression is fixed — completely.** Per-block bidi in chat markdown, hard-LTR code isolation with a real instrument style, Monaco working in Arabic mode, a decongested agent console header, working `{n}` interpolation, and a bidi-safe composer.
- **Crash-resilient on software compositors.** A renderer crash (SwiftShader) now trips a persisted circuit breaker and the app comes back fully usable in `html.fx-off` — no more crash loops.
- **The agent can now design and build real web UIs.** A bundled WebCraft design-system kit (900+ lines, WCAG AA, token pairs, RTL-safe), three premium single-file scaffold templates, a deterministic `ui_quality_check` probe the engine auto-runs and enforces, and `image_generate` for real hero art.
- **Honest UI everywhere.** Feedback (likes/dislikes) that persists, an always-reachable Plans close button, Pro/Team stamped "Currently not active · غير مفعّل حالياً", and Appearance as a first-class settings section.

---

## 1. Design integrity (the headline)

### 1.1 Chat markdown is now per-block bidi
- Every block element in chat markdown carries `dir="auto"` **and** `unicode-bidi: plaintext`, so each paragraph, list item, table cell, and heading takes its direction from its **own** content.
- Colons and numbers no longer scramble: a line like `الوقت: 12:30` or an English sentence inside an Arabic record now renders exactly as written, instead of punctuation and digits migrating across block boundaries.

### 1.2 Code blocks: hard LTR isolation + a full `.kb-code` instrument style
- Code blocks are **hard-isolated LTR** regardless of the surrounding RTL context.
- The `.kb-code` block ships a **complete** instrument style — header bar, language chip, and copy button. Previously the lang chip and copy button had **no styles at all** and collided with the surrounding layout; they are now first-class, styled controls.

### 1.3 Monaco renders correctly in Arabic mode (was a black void)
- Opening the editor with the UI in Arabic RTL mode used to render a **black void**: Monaco has **no RTL support**, and mounting it inside an RTL context broke the surface entirely.
- The fix is the Monaco team's own recommended approach: **hard-LTR isolation of the editor surface**, while all surrounding chrome stays Arabic RTL.
- The same isolation is applied to the **DiffEditor** and to **xterm helper nodes**, so no embedded surface regresses in RTL.

### 1.4 Agent console header decongested
- The five secondary actions — **recap, html-export, review, skills, compact** — moved into a **"⋯" overflow menu**.
- Nothing truncates anymore, in either language, at any practical window width.

### 1.5 i18n interpolation fixed
- `t()` now **supports parameters**. Previously `{n}`-style placeholders were rendered **literally** in the Arabic status line ("{n} …"); they now interpolate real values everywhere.

### 1.6 Bidi-safe composer
- The `@` and `/` sigils in the Arabic placeholder are **RLM-glued**, so they stay attached to their commands instead of floating to the wrong side of the line.
- Direction fixes for **slash-command chips**, the **file-type legend**, and **recent-session rows** — the inline-span jam was **root-caused and fixed**, not papered over with one-off margins.

### 1.7 SwiftShader crash-resilience — persisted circuit breaker
- On machines where the GPU stack falls back to **SwiftShader** (software compositing), the `backdrop-filter` + aurora effect stack could crash the renderer process, previously into a crash loop.
- A crash now trips a **persisted circuit breaker**: a marker file (`surnia-fx-off`) is written to the Surnia data folder (`userData`), and the window **immediately reloads with `html.fx-off`** — opaque fills, zero blur, zero animation.
- The breaker **persists**: every future boot starts in degraded-but-fully-usable mode until the marker is removed. Users keep a working app instead of a crash loop.
- Optional **`SURNA_FX_OFF=1`** forces degraded mode from the very first frame — useful for VMs, RDP sessions, and CI.

---

## 2. AI build capability — "give it capabilities"

### 2.1 WebCraft design-system kit ships with the app
- `dist/webcraft/design-system.css` (**900+ lines**) is bundled with every install:
  - **Semantic fg/bg token PAIRS** — every text color is defined as a pair with its background, so contrast is **guaranteed structurally**, not by hoping the model picks well.
  - **126 component classes**, light + dark, **RTL-safe**, **WCAG AA**.
- The agent is instructed to **START from the kit** — build on top of it, never reinvent tokens.

### 2.2 Three premium scaffold templates
- **static-site** — upgraded to a full premium landing page: theme toggle, scroll-reveal, working JS.
- **web-dashboard** (new) — canvas charts, sortable table, responsive sidebar.
- **web-portfolio** (new) — masonry gallery, contact form with validation.
- All single-file, **zero-dependency**. The registry now holds **10 templates**; `tests/scaffold.e2e.cjs` was updated to match.

### 2.3 NEW tool: `ui_quality_check` — deterministic visual probe
- Spawns an **offscreen window at 390 / 820 / 1366 px** and reports, deterministically:
  - horizontal overflow **with the offending elements named**,
  - low-contrast text (**< 3:1**),
  - sub-12px text,
  - missing `viewport` / `lang` / `title` / `alt`,
  - unlabelled interactive elements,
  - console errors.
- **Mandatory** in the web-craft protocol — and the **engine also auto-runs it once** after any run that wrote UI files, feeding failures back for a fix round. Because the probe needs **zero model judgment**, it works with **every provider**.

### 2.4 NEW tool: `image_generate`
- Real image generation from text — **any language, including Arabic prompts** — via a **keyless, allow-listed endpoint**.
- Output is written **inside the workspace write-wall**: **SSRF-safe**, **12MB cap**, **content-type verified** before anything lands on disk.
- Use it for hero art, illustrations, and logos.

### 2.5 Web-craft protocol rewritten (system prompt)
- **Kit-first**: the WebCraft kit is the starting point for every UI task.
- **Hard design laws**: 5 colors, 2 fonts, **token pairs only**.
- **Anti-slop rules** against generic AI-look output.
- **Design-brief-before-code** for vague requests: the agent states the brief before writing a single line.

---

## 3. Fixes

- **Likes/dislikes feedback reworked** — persistent recorded state, exactly **one record per message**, **honest failure states** (a failed submission says so and can be retried), an **Enter/Escape note flow**, and state **re-hydrated across sessions**.
- **Plans screen** — the close button is **always visible** on a proper surface; **Escape respects stacked modals** (it closes the top one only); Pro/Team plans are clearly stamped **"Currently not active · غير مفعّل حالياً"**.
- **Appearance settings are first-class** — theme + language moved into it, a **live CSS-variable preview strip**, a **reset-to-defaults** button, and full bilingual labels.
- **Live run pill** — shimmer while running, plus an **adaptive elapsed clock**.
- **Recent-session rows and the file-type legend are RTL-safe** (shared root cause with the composer inline-span jam).

---

## 4. Agent guidance

- Template registry is now **10 templates** (`static-site` upgraded; `web-dashboard` and `web-portfolio` added).
- `tests/scaffold.e2e.cjs` updated to cover the expanded registry.

---

## 🔐 Security notes

- **`image_generate` is fenced**: requests go to a **keyless, allow-listed endpoint only** (no arbitrary URLs), responses are **SSRF-guarded**, capped at **12MB**, and the **content-type is verified** before writing. Files land **inside the workspace write-wall** — the tool cannot be used to write outside your project.
- **`ui_quality_check`** runs in an **offscreen window** against your workspace files only; it executes no model-supplied code and returns findings, not mutations.
- **The SwiftShader circuit breaker** persists a single marker file (`surnia-fx-off` under userData). It only **degrades visuals** — it never changes permissions, approvals, or security posture. `SURNA_FX_OFF=1` is strictly opt-in.
- Everything from the hardened base is untouched: write walls, command risk classes and approval ordering, safeStorage-encrypted keys, audit log, and the no-telemetry guarantee.

---

## ▶️ Upgrade notes

1. **No data migration.** Settings, sessions, memories, and API keys carry over as-is.
2. **After a crash on a software compositor**, the app intentionally stays in `html.fx-off` (opaque, no blur/animation). To re-enable effects after fixing your GPU drivers: quit Surnia and delete `surnia-fx-off` from the Surnia data folder.
3. **`SURNA_FX_OFF=1`** starts the app degraded from the first frame — recommended for VMs, RDP, and CI.
4. **New bundled asset to know about:** `dist/webcraft/design-system.css` ships inside the app and is what the agent builds UI from.
5. **If you script scaffolds:** the template registry is now 10 templates; `tests/scaffold.e2e.cjs` is the executable reference.
