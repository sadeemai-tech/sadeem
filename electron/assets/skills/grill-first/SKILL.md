---
name: Grill-First Planning
description: Interview the user with smart option cards BEFORE writing code when a request is ambiguous or high-impact — recommended option first, codebase questions answered by reading, not asking.
---

# Grill-First Planning (interview before code)

Use this skill when the task is ambiguous, high-impact (schema changes, refactors, new features),
or the user asked you to "grill" them (/grill). Never use it for clear, small requests.

## The loop

1. **READ BEFORE ASKING** — inspect the workspace first (workspace_map, read_file, search_files).
   NEVER ask a question the codebase can answer.
2. **ONE question at a time** — use the ask_user tool with 2-4 concrete options.
   - Put your RECOMMENDED option FIRST and label it "(Recommended)".
   - Each option must be a real, distinct design choice — not filler.
   - Allow free text (the tool does by default).
3. **Each answer shapes the next question** — 5 questions maximum, then STOP.
4. **Restate the spec** in 5 bullets (what will be built, the chosen approach, what is explicitly
   OUT of scope), then start implementing immediately.

## Question quality bar

Good questions change WHAT you build or HOW it is structured: scope, data model, UX behavior,
trade-offs (speed vs correctness, simplicity vs flexibility), integration points, deployment target.
Bad questions (never ask): things readable from files, trivial naming, anything Google-able.

## Arabic users

When the UI language is Arabic, write the question and options in Arabic; keep technical terms
(file names, framework names, HTTP verbs) in English.
