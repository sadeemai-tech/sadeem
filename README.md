<p align="center">
  <img src="https://sadeem-ai.com/sadeem-app-logo.png" width="72" alt="SADEEM" />
</p>

# SADEEM

**Local-first AI coding agent · 145 tools · Arabic-first, fully bilingual**

SADEEM is a Windows coding agent that keeps your code, credentials and learning files on your machine. The same engine runs in the terminal. Free during the public season — bring your own provider key.

**سديم** وكيل برمجة محليّ الاتجاه بـ145 أداة، ومحرّك واحد في التطبيق والترمينال. المفاتيح وملفات التعلّم تبقى على جهازك، والاتصال يذهب مباشرة إلى مزوّدك بلا وسيط. مجاني خلال الموسم العام.

🌐 [sadeem-ai.com](https://sadeem-ai.com) · 📥 [Download](https://sadeem-ai.com/download) · 📖 [Docs](https://sadeem-ai.com/docs) · Changelog: [sadeem-ai.com/changelog](https://sadeem-ai.com/changelog)

> SADEEM is free during the public season. Source is not open — this repository is the project's trust page: what ships, how it behaves, and where to get it.

---

## What it does

A local-first agent with 145 schema'd tools. Profiles change what the model sees for one turn — never what it may call. The same `runAgent` engine powers the desktop app, the terminal CLI, scheduled jobs and the local control API.

## Features

### Core agent
- **145 real tools** with JSON schemas and routing rules; add your own MCP servers. Approval modes are real: `plan` and review modes hard-deny writes and mutating commands, and every auto-approved write still takes a checkpoint.
- **Long tasks that keep going** — rounds continue automatically and compaction happens at the model's real context window, not a fixed turn count.
- **Mid-run steering** — correct the agent at the next tool boundary instead of restarting the run.
- **Two effort axes** — a real 2× deep step budget, plus each model's own reasoning levels sent as the provider declares them. No invented stops.
- **Context Lens** — the ring uses the last turn's real token delta, marks estimates with `≈`, and resolves the window from the model's own catalog entry.
- **Local control API** — a loopback-only, token-authenticated HTTP surface for scripts and CI to run the same engine with a fail-closed approval policy.

### Memory & learning
- **Living PLAYBOOK.md** — after each run, a versioned file of what worked and failed, with a diff. Advisory, readable, editable.
- **Persistent DNA** — a user model that keeps learning; when its active window fills, the oldest well-learned fact retires and a brand-new fact is never dropped.
- **Cross-session recall** — real excerpts from past sessions with their titles, not invented summaries.
- **Explicit memory continuity** — facts and pins you ask it to remember survive across runs, within honest bounds.
- **Confidence-based playbook** — repeated patterns gain confidence and are read back as advice, never as bans.

### Verification & proof
- **Proven-change pipeline** — the harness checks "done" against files, commands and tests, with a deterministic fake-test detector and a mutation gate on changed lines. A verifier from a different model family re-checks with read-only commands.
- **Signed re-runnable proof** — real changes produce a signed package anyone can verify with no key and re-run the recorded test command.
- **Proof Center** — an evidence ledger of what the UI actually has: commands, verdicts and the proof package.
- **Trajectory Replay** — rebuild a run from three real ledgers (messages, journal, trace); every step names its source and unpaired results are flagged.
- **Capability Compass** — an auditable map from your typed intent to the real tool inventory, mined from the tools' own routing sentences.
- **Taint tracking** — a poisoned README or fetched page can't push a dangerous command through on autopilot, even in full-access mode; the agent stops and shows the source.
- **Retry-resilient verification budget** — provider retries don't consume the verification budget; exhaustion fails explicitly.

### Automation
- **Scheduled jobs** — cron, file-watch, loopback webhook and CI-failure polling all run the same engine headlessly, with a test-suite proof gate and a durable event ledger.
- **Saved Flows** — a named prompt you save and re-run with one click through the real chat path; the counter moves only when a real turn settles.
- **Local HTTP control API** — drive sessions and stream events from your own script or CI.

### Multi-agent & delegation
- **16 specialist child agents**, each with the full tool registry, launched truly in parallel with per-task deadlines; one hung child never stalls the run.
- **Subagent drill-in** — click a child agent to see its real delegated prompt, progress and tool-call transcript. Nothing in the transcript is invented.
- **Configurable parallel limit** — you decide how many subagents may run at once; the setting is persisted and honoured by both launch paths.

### Device & surfaces
- **One engine in the app and the CLI** — `sadeem run "<task>"` calls the same engine, no Electron binary required. Real terminal approval prompts; keys stay local.
- **SADEEM Remote** — scan a QR to drive the desktop agent from a phone on the same Wi-Fi: send tasks, steer, approve, abort, watch the live transcript. No cloud, no tunnel.
- **Browser & desktop control** — the agent drives a real browser, captures screenshots for a vision model to inspect, and can use local apps, clipboard and notifications.
- **Everything in the `+` menu** — slash commands, file mentions, prompts, images and rewind insert into the composer; nothing is auto-sent.
- **Verified preview** — the app previews the built page; no "ready" until a real HTTP GET answers.

### Extensibility
- **Real MCP client** — add your own servers over stdio, HTTP or SSE; every advertised tool becomes a real dispatchable definition with an approval gate and change-pinning.
- **Plugins & starter packs** — contribute real MCP servers and slash commands; install, disable and uninstall are transactional and reversible.
- **Skills library** — inspect, edit, duplicate, install from a catalog, or import from another agent; every action writes a real skill file.
- **Git worktrees** — the app's worktree service verifies its base, jails paths, refuses dirty deletes and prunes stale registrations.

### Arabic & documents
- **Full Arabic RTL interface** — complete EN/AR UI, prompt in either language, no mixed-language strings.
- **RTL document builders** — real Arabic `.docx`/`.pdf` with correct shaping and an Arabic-capable font, not a description of one.
- **Library & Repo Wiki** — files the agent produces show up from a real disk scan; the Wiki reads your repo's real docs with no AI key required.
- **Keyless image generation + real ffmpeg** — image generation is a tool, no image API key needed.

## Honest notes
- Windows desktop app; the engine also runs in a terminal. Bring your own key (12 providers, including Ollama for keyless local models). Your provider bills you.
- Free during the public season. No subscription, no credits, no checkout today.
- Local-first describes where code and keys live; web tools, MCP, image generation and Remote use the network.
- The Windows installer is not code-signed yet, so SmartScreen may warn. This is expected during the public season.
- Gates are mechanisms, not promises about model behaviour: the harness checks evidence; it cannot guarantee a weak model answers wisely.

## Get started
Download for Windows: https://sadeem-ai.com/download · Documentation: https://sadeem-ai.com/docs
