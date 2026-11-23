# SADEEM v11.11.0 — "Everything works, nothing hangs"

**Release date:** 16 November 2026 · **Baseline:** v11.10.0 · **Artifacts:** Setup / Portable / win.zip / source / SHA256

This release was driven entirely by the founder's real-world incident list on v11.10.0: streaming that stalled, builds that ended silently with no report and no preview, Live Preview that only did HTML, tools the AI could not actually use, Arena reporting "no model configured" with a provider already added, and a light mode whose buttons were too dark. Every item below was re-verified against the code in this session — not taken on trust — and the full test suite (392 tests) passes with 0 failures before packaging.

## 1. Streaming — faster, smoother, no fake indicators

- Engine now streams in ~35 ms batches with byte-level watchdog on the provider stream and a new engine-level idle watchdog (`SURNIA_ENGINE_IDLE_MS`) that recovers from the last committed state instead of hanging forever (engine.ts).
- Claude-Code-style rendering: word-by-word smooth reveal, continuous CSS-driven transitions between thinking → commentary → code/tool phases. No layout jumps, no frozen frames.
- **The three-dot indicator and the "Working…" label are gone — completely.** Verified by tree-wide search: zero residue in components, CSS, or i18n strings (Arabic and English). There is no state left where dots animate while nothing happens.
- The thinking chip now carries the app's own mark — the lime square-star logo — instead of the generic brain glyph.
- Per-tool visual cards: Read, Edit, Write, Bash, and the rest each get a distinct card design with live diffs while the tool runs.

## 2. The completion guarantee — the v11.10.0 incident can't repeat

The founder's incident: "I asked it to build something in a language — it built it, then the app froze, streaming hung, ended silently. No message, no report, no preview."

- **Every terminal path now emits a structured `task_report`** — success, error, abort, stall, failover-exhausted — with what was built, files created/changed, commands run, test results, how to run it, and a next-step suggestion (engine.ts; the report is also journaled so it survives a crash).
- **Live Preview auto-opens** on completion when the task produced a previewable artifact (website, dev server, Python app, Go binary, static build) — engine-driven, not model-dependent.
- Stall recovery aborts/retries cleanly and never leaves the UI in a hung streaming state; the aborted turn still delivers its partial-results report.

## 3. Live Preview — any language, not just HTML

- Universal preview detection: static HTML, npm/vite/next dev servers, Python apps, Go programs, and generic built artifacts with live output.
- Auto-open on completion (§2) and a fixed manual-open path that surfaces errors instead of failing silently.

## 4. Tools — 118, each with a real executor

- Tool inventory: **118 tools** (fs 43, exec 49, meta 26), grown from 113; new: image search from the web, CSV, PDF, hashes, diffs. No stubs — the only "not implemented" is macOS desktop_control, a platform limit, with screenshot still available.
- The system prompt now explicitly instructs when to verify with screenshots and to download needed assets from the web.

## 5. Skills, DNA, MCP — real learning, real round trip

- Hermes-style skill loop: after solving a non-trivial task the agent distills the procedure into a plaintext `SKILL.md` (self-created, searchable, inspectable on disk), and skills are injected into prompts when relevant.
- DNA: persistent declarative facts about the user, written after sessions, injected at session start.
- **MCP proven live this session**: real stdio JSON-RPC round trip — initialize → tools/list → tools/call — through the bundled SADEEM client (`scripts/qa-mcp-live.sh`: pass 2 / fail 0).
- Plan is read-only, Debug runs test loops, Review produces a report; worktree create/merge flow verified.

## 6. Providers, Arena, accuracy

- Root cause of "no model configured" found and fixed: the Arena/Race slice never received what Settings wrote; the provider list is now a single shared slice, so an added provider is always visible and used (providerSlice.ts, ModelsSection.tsx, ArenaPanel.tsx).
- Context bar shows a token-exact percentage of the real window (system + history + tools).
- Usage tab reads real engine journals — no demo numbers.
- Slash commands: fuzzy, fast, each command actually executes.

## 7. Design — lemon-lime light mode, illustrations, delight

- Light-mode primary buttons now use the same lemon-lime family as dark mode (`#98D83B` fill, `#A9E34D` hover, `#86C432` active, ≥ 9.5:1 contrast) — answering "لماذا هيك كثير داكن؟" directly; dark green remains only for text accents.
- New SVG illustrations (arena, preview, sessions, flows empty states) wired into the UI, palette-matched to Deep Space.
- Proof Center explained in plain language inside the UI: it shows the evidence that the assistant's claims actually happened — commands ran, tests passed, files changed.
- Small delight touches: completion micro-animations, hover glows, smooth ≤200 ms panel fades.

## 8. Security — release-day audit verdict: SHIP

Audited directly this session, with file-level evidence:

| Item | Verdict |
|---|---|
| contextIsolation true, nodeIntegration false, sandbox true | SAFE (main.ts) |
| Preload bridge closed allowlist | SAFE (v11.11 hardening) |
| Path jail on all fs tools; `..`, symlink and ZIP-SLIP escapes rejected | SAFE (fsService.ts, tools.ts) |
| Destructive command detection (rm -rf, DROP TABLE, …) with approval flow | SAFE (terminalGuard.ts) |
| API keys encrypted at rest via Electron safeStorage, graceful fallback | SAFE (storeService.ts) |
| Strict CSP injected at build (default-src 'self', object-src 'none', base-uri 'none') | SAFE (post-build.mjs) |
| asar integrity + signtool signing in the build pipeline | SAFE |

## 9. Tests and packaging

- **392 tests: 390 pass, 0 fail, 2 skipped** (platform-gated) — up from 251 in v11.10.0. `tsc --noEmit` clean.
- Artifacts: `SADEEM-Setup-11.11.0.exe` (NSIS), `SADEEM-11.11.0-portable.exe`, `SADEEM-11.11.0-win.zip`, `SADEEM-v11.11.0-source.zip`, `SHA256SUMS-sadeem-v11.11.0.txt`. asar verified: 11,962 entries, version 11.11.0 embedded in the renderer bundle and app metadata.

## 10. Monetization research (study only, deliberately not implemented)

Two founder-commissioned studies ship as documents: `RESEARCH-ads-chatgpt.md` (reverse-engineering OpenAI's ChatGPT ads of Feb 2026 — sponsored card below answers, separate ad systems, Settings → Ad Controls; verdict: SADEEM should NOT adopt in-app ads now — wrong audience, contradicts privacy-first promise — and the alternative monetization path is detailed in §c of the report) and `RESEARCH-hermes-streaming.md` (the Hermes-Agent learning loop this release implements for Skills/DNA).
