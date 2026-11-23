# FEATURE-TRUTH V1144 — Ground-truth feature map for website writers
# خريطة الحقائق — المرجع المعتمد لكتابة موقع سديم

> **Read-only research.** No source file was edited by this wave. Every statement below is drawn from the app source in this repo, with `file:line` evidence. This is the reference the website writers must use. Marketing adjectives are deliberately absent.
> بحث للقراءة فقط؛ لم يُعدّل أي ملف كود. كل سطر هنا مستند إلى الكود المصدري مع رقم الملف والسطر. هذا هو المرجع لكاتب الموقع، بلا صفات تسويقية.

## 0. How to read this map / كيف تقرأ الخريطة

Verdict legend / رموز الحكم:

| Verdict | المعنى | Writer rule / قاعدة الكاتب |
|---|---|---|
| **SHIPPED** | Real code path, wired end-to-end, reachable by the user. | May describe in plain, concrete language. |
| **SHIPPED (mechanism) ⚠** | The harness mechanism is real, but the *model's behaviour* is not guaranteed by it (a model may still ignore a prompt). | Describe the mechanism, never promise the behaviour as absolute. |
| **PARTIAL — DO NOT MARKET** | Exists in code but unreachable, half-wired, or only advisory. | Never mention on the public website. |
| **INTERNAL ONLY** | Real and important, but a tuning knob / secret / build detail. | Never mention; see §13. |

Two kinds of numbers:
- **Safe to publish** (user-facing, founder-endorsed): **145 tools**, **16 specialists**, **12 providers**, and the **signature instruments** — but frame them as *two unique instruments + a DNA explanation lens* after the v1140 merge (see §5), not as "three equal standalone AIs".
- **Never publish** (internal tuning): every other threshold, timeout, cap, env var, version staging string — see §13.

---

## 1. The agent core (`electron/agent/engine.ts`)

| # | Honest name (EN) / الاسم الصادق (AR) | What a developer actually gains (one sentence, no hype) | Evidence | Verdict |
|---|---|---|---|---|
| 1.1 | **One real agent loop, same in GUI and CLI** — حلقة الوكيل الحقيقية | `runAgent()` converts the UI transcript to provider messages, streams turns, dispatches the full tool registry behind an approval gate, and always ends with `task_report` + `turn_end`; the CLI calls this exact function, not a wrapper. | `engine.ts:2039-2072`, `:2074-2164`; `cli.ts:492-519` | **SHIPPED** |
| 1.2 | **Automatic long-run continuation** — استمرار تلقائي للمهام الطويلة | When a round exhausts its step budget the engine re-enters the loop with a fresh budget, compacting as needed; by default there is **no silent round cap** — work ends only on done, abort, or genuine provider death. | `engine.ts:3696-3734` (unbounded default, `Number.POSITIVE_INFINITY`), `:3768-3794` | **SHIPPED** (do not publish the cap mechanics — §13) |
| 1.3 | **Guaranteed honest terminal report** — تقرير ختامي صادق | Every terminal path (completed / error / aborted / failover-exhausted) emits a structured `task_report`; failed tool calls or a last-call failure force outcome `'error'` instead of a clean `'completed'`. | `engine.ts:4909-4950` (`outcome` logic `:4934-4940`), `:5119-5160` | **SHIPPED** |
| 1.4 | **Live activity signal** — إشارة نشاط حية | A pure `heartbeat` event is emitted during setup and compaction so the UI cannot show a frozen blank screen while tools/MCP/settings load. | `engine.ts:2088-2089`, `:2331-2360`, `:5676-5690` | **SHIPPED** (cadence is internal — §13) |
| 1.5 | **Compaction at 90% of the model's real context window** — ضغط السياق عند ٩٠٪ من النافذة الحقيقية | Compaction fires from the provider's real token count (or the real-window-derived char fallback), preserves the **original user task**, pinned context, decisions/files/pending steps and cumulative memory, and flattens tool blocks so the compaction call cannot 400. | `engine.ts:5594-5612` (one gate, no fixed small-count trigger), `:5613-5760`, `:31-33` import of real-window math | **SHIPPED** (threshold number is internal — §13) |
| 1.6 | **Approval gate with four permission modes** — بوابة الموافقة بأربعة أوضاع | `plan / default / autoEdit / fullAccess` control auto-approval; plan/review modes are truly read-only (writes and mutating commands hard-denied except `plan.md`); "always allow" rules and deny rules persist per workspace, deny wins; auto-approved writes still get a rollback checkpoint; MCP tools are never auto-approved by mode alone without opt-in. | `engine.ts:3240-3264` (read-only modes), `:3265-3289` (doom loop), `:3290-3342` (rules/auto-approve/checkpoint), `:3300-3320` (MCP opt-in), `:3367-3375` (approval card + audit) | **SHIPPED** |
| 1.7 | **Proven-change pipeline** — خط أنابيب الإثبات | For real work (writes/commands/verification) the harness audits prose claims against evidence, runs red→green parsing, a deterministic fake-test detector, a mutation gate on the changed lines, and saves a signed, re-runnable proof package; a gate-caught round counts as a False-Done. | `engine.ts:4227-4269` (claim audit), `:4395` (red-green), `:4448-4520` (mutation gate), `:4525-4605` (proof + False-Done); `proof.ts:1-25` | **SHIPPED (mechanism) ⚠** — the gates are real; a model can still produce a weak answer. Never claim "the AI never lies". |
| 1.8 | **Verification budget that rate-limits cannot eat** — ميزانية تحقق لا تستهلكها أخطاء المزوّد | Gate attempts that die on retryable provider errors (429/5xx/network) are refunded; only real verdicts spend the budget, and exhaustion applies an explicit fail posture. | `budget.ts:1-19`, `:26-47`; `engine.ts:4046-4065` | **SHIPPED** (budget numbers internal — §13) |
| 1.9 | **Crash-resilient run journal + trace + receipt** — سجل تشغيل مقاوم للانهيار | Every tool outcome is journaled to disk as it happens (`journals`), a structured receipt lists files touched/commands/rounds/duration, and a crash leaves a detectable "no finish line" marker. | `engine.ts:3736-3737`, `:4847-4859`; `cli.ts:632-683` (journal reading) | **SHIPPED** |
| 1.10 | **Message steering / queue / goals** — توجيه الرسائل وقائمة الانتظار والأهداف | A user can send messages or steer the running agent; they land in a FIFO queue consumed by the loop, and an explicit `/goal` adds a goal verifier and progress tracking. | `engine.ts:1627-1749`, `:958-975`, `:3720-3734` | **SHIPPED** |

**What NOT to say about the core:** "unlimited thinking", "infinite free runs", "the AI always uses all tools", "zero mistakes", "no configuration needed". The default is unbounded by *operator cap*, not by cost; every provider call still bills the user's key.

---

## 2. The 145 tools (`electron/agent/tools.ts`, `electron/agent/tool-defs.ts`)

`CORE_DEFS` is the literal inventory of **exactly 145** defs (`tool-defs.ts:65`, count assertion `:2485-2486`); every def has a name, JSON-Schema parameters and a description with routing sentences. Dispatch is a real `switch` of 145 `case`s (`tools.ts:1401`, `:1467-1951`) into real executors; a crashing tool becomes a failed `tool_result`, never a dead loop (`tools.ts:1958-1962`). Profiles are a **view only** — they change what is advertised, never what can be called; strong models are advertised all 145 (`modes.ts:322-420`).

Grouped here **by user value**, not by count:

| Group / المجموعة | Real tools (examples, all from CORE_DEFS) | Concrete gain | Evidence | Verdict |
|---|---|---|---|---|
| **A. Read & understand the workspace** — فهم المشروع | `list_dir`, `read_file`, `read_image`, `search_files`, `glob_files`, `fs_browse`, `workspace_map`, `code_search`, `find_refs`, `symbol_outline`, `impact_of`, `repo_map`, `semantic_search` | The agent navigates and maps code, symbols, call sites and blast radius before editing, instead of guessing. | `tool-defs.ts:67-285`, `:1135-1181`, `:866-879`; `tools.ts:1991-2415`, `:2682-2751` | **SHIPPED** |
| **B. Edit & run** — التعديل والتنفيذ | `write_file`, `edit_file`, `multi_edit`, `multi_file_edit`, `move_path`, `delete_path`, `run_command`, `run_background`, `process_output`, `stop_process`, `process_list`, `process_kill` | Files are written with verification, diffs go through the approval gate, long processes keep logs and can be stopped cleanly. | `tool-defs.ts:115-224`, `:1360-1425`; `tools.ts:2434-2681`, `:2783-2910`, `:5055-5165` | **SHIPPED** |
| **C. Code intelligence & debugging (LSP/DAP)** — ذكاء الكود والتصحيح | `lsp_definition`, `lsp_hover`, `lsp_diagnostics`, `lsp_references`, `lsp_rename`, `lsp_completion`, `lsp_languages`, `debug_start`, `debug_state`, `debug_eval`, `debug_step`, `debug_stop` | Real language-server navigation and a real DAP debugger: breakpoints, variable inspection, stepping and expression evaluation. | `tool-defs.ts:1183-1324`, `:2281`; `tools.ts:1766-1806`; `lsp.ts`, `debugTools.ts` | **SHIPPED** |
| **D. Build real artifacts** — إنتاج ملفات حقيقية | `make_document`, `gen_ui`, `pdf_make`, `pptx_make`, `docx_make`, `xlsx_make`, `image_generate`, `image_edit`, `media_ffmpeg`, `export_project`, `archive_create`, `archive_extract` | The agent produces actual PDF/PPTX/DOCX/XLSX, images, media and zip archives in the workspace — not descriptions of them. | `tool-defs.ts:628-700`, `:1498-1655`, `:2207-2235`; `tools.ts:1744-1745`, `:1847-1859`, `:4897-5054` | **SHIPPED** |
| **E. Web, browser & desktop control** — الويب وسطح المكتب | `web_search`, `web_fetch`, `search_web`, `http_request`, `download_file`, `browser_*` (navigate/snapshot/click/type/eval/console/pdf/network/tabs/download), `screenshot`, `desktop_control`, `clipboard_*`, `device_launch_app`, `notify_user` | The agent can research with cited sources, drive a real browser and the local desktop, and stream screenshots back. | `tool-defs.ts:334-493`, `:546-597`, `:834-862`, `:1415-1496`; `tools.ts:1504-1606`, `:3685-4040`, `:1841-1880` | **SHIPPED** (browser needs the browser runtime; `gh` needs GitHub CLI) |
| **F. Data, DB & QA** — البيانات وقواعد البيانات والجودة | `sqlite_query`, `db_query`, `db_seed`, `db_migrate`, `csv_read`, `csv_write`, `pdf_read`, `test_run`, `lint_check`, `lighthouse`, `e2e_run`, `a11y_audit`, `ui_quality_check`, `coverage`-adjacent gates | The agent queries/seeds/migrates databases and runs tests, lint, Lighthouse, e2e and accessibility audits with captured results. | `tool-defs.ts:703-749`, `:1718-1753`, `:1821-1866`, `:2043-2151`; `tools.ts:1678-1682`, `:1881-1943` | **SHIPPED** (external tools must be installed in the workspace) |
| **G. Workflow & memory** — سير العمل والذاكرة | `todo_write`, `task`, `propose_plan`, `use_skill`, `create_skill`, `remember`, `dna_note`, `recall_memory`, `recall_result`, `pin_context`, `checkpoint_save/list/restore`, `ask_user`, `tool_help` | Plans, reusable skills, durable memory, context pinning, checkpoints and structured user questions are first-class tool calls. | `tool-defs.ts:288-332`, `:820-1132`, `:2262-2280`; `tools.ts:3208-3606`, `:1701-1728` | **SHIPPED** |
| **H. Git, environment & utilities** — Git والبيئة والأدوات المساعدة | `git_local`, `git_platform`, `create_pull_request`, `pr_status`, `worktree_create`, `worktree_remove`, `env_probe`, `env_install`, `env_manager`, `port_probe`, `schema_docs`, `sys_info`, `network_info`, `hash_file`, `uuid_gen`, base64/url/regex/json/color/diff/text tools | Repo operations, PR creation, environment setup and a deterministic utility bench are callable from the same loop. | `tool-defs.ts:752-830`, `:1326-1348`, `:1736-2260`; `tools.ts:1684-1700`, `:1807-1829`, `:1883-1951` | **SHIPPED** |
| **DEAD — DO NOT MARKET** | `preview_open`, `worktree_list` | Executors exist in the dispatcher, but **no def is registered in CORE_DEFS**, so the model can never emit them. | executor: `tools.ts:1642-1643`, `:1688-1692`; **absent** from `tool-defs.ts` name list (`:65-2485`) | **DEAD — DO NOT MARKET** |

**Honest caveat (do not hide, do not overclaim):** the engine can dispatch any of the 145 tools that the model actually calls; whether a given model *chooses* to call the right one on a vague request is model behaviour, not an engine guarantee. Historical reality test: `docs/AI-REALITY-V1132.md:39-70`. Do not market "the AI always uses all tools" as an absolute.

---

## 3. What learning actually persists (`dna.ts`, `playbook.ts`, `memoryContinuity`)

| Capability | What persists and what the developer gains | Evidence | Verdict |
|---|---|---|---|
| **Surnia DNA — persistent user model** | A per-user model plus a per-workspace overlay: profile (role, expertise, languages, likes, styleNotes), learned patterns (command/workflow/style/correction) with repetition-based confidence, and explicit feedback. Stored at `<userData>/dna.json` and `<workspace>/.surnia/dna.json`, owner-only 0600; workspace layer merges on top by pattern id. | `dna.ts:1-23`, `:43-68`, `:204-261`, `:277-302` | **SHIPPED** |
| **DNA is advisory, never a rule** | The prompt header explicitly says learned defaults never restrict permissions and the current request always overrides them; dislikes are omitted unless the user explicitly said them. This is why the agent cannot "refuse because DNA said so". | `dna.ts:610-678` (`ADVISORY` header `:652-656`), `engine.ts:7764-7771` (extractor never invents dislikes) | **SHIPPED** |
| **Bounded but lossless learning** | Active window ≤60 patterns; at the cap the **oldest, most-reinforced** facts retire so a brand-new fact is never dropped; `factsRecorded` is the cumulative, never-decreasing counter. 8 prompt slots (4 reserved for newest) so new learning always reaches the next prompt. | `dna.ts:43-68`, `:402-421`, `:616-646`, `:766-809` | **SHIPPED** (the 60/8/4 numbers are internal — §13) |
| **Living Playbook — self-updating workspace file** | After a completed run one no-tools call extracts worked / failed / preferences / recipes + a one-line `learned`; the result merges into a **real markdown file** `<workspace>/.surnia/PLAYBOOK.md`, a structured sidecar, and a version-history JSON with per-revision diffs; the current playbook is injected into the next run's prompt (advisory). Repeated lessons harden (`count++`); the UI toasts "SADEEM learned: …". | `playbook.ts:1-21`, `:33-41`, `:478-551`, `:565-584`, `:345-412`; `engine.ts:4713-4740`, `:7861-7945` | **SHIPPED** |
| **Cumulative session memory + continuity** | A memory snapshot is written at compaction and after every run, rendered into the same dynamic prompt tail; explicit `remember` facts and pins are now injected (the old "AI doesn't learn from me" root cause) via `memoryContinuity`. | `playbook.ts:376-410`; `engine.ts:5716-5736`, `:4664-4683`; `tools.ts:26-32` | **SHIPPED** |
| **Cross-session recall** | A lazily-built BM25-lite index over the newest sessions + DNA patterns answers `recall_memory` with real excerpts and session titles, with a hard timeout and graceful degradation. | `dna.ts:811-988` | **SHIPPED** |
| **Three DNA update triggers** | Auto-extraction after a run (`learnDNAFacts` with retry), explicit UI feedback / approval-denial capture, and the agent's own `dna_note` tool. | `engine.ts:4685-4711`, `:3375-3401`; `dna.ts:530-587`, `:1127-1134` | **SHIPPED** |
| **Corrections → rules** | Repeated denied commands / writes / user edits are grouped; after 3 similar hits the engine suggests saving the corrected shape as a flow; a flow can be validated by replay. | `flowsService.ts:610-778`; `engine.ts:3383-3389` | **SHIPPED (mechanism) ⚠** — suggestion, not silent enforcement |
| **Skill factory** | A completed `/goal` with real work distills the transcript into a reusable `SKILL.md` in `.surnia/skills` via a skill-writer subagent; skills can be refined and injected by task match. | `engine.ts:4771-4799`; `agents.ts:178-188`; `skills.ts` | **SHIPPED** |

---

## 4. The 16 specialists (`electron/agent/agents.ts`)

**Truth to write:** specialists are **not** capability tiers. Every one has the **full tool registry** (145 core + MCP + provider-native) and runs its own agent loop; they differ only by system-prompt role/personality. There is no "read-only specialist" (`agents.ts:1-13`, `:23-29`, `tools: '*'` on every row). `getAgent()` falls back to `general` (`:198-200`); the `task` tool accepts the `agent` id (`tools.ts:1502`).

| Group / المجموعة | Specialists (`id` — name) | What each actually does | Evidence |
|---|---|---|---|
| **Research (3)** — بحث | `explore` — Codebase Explorer · `web-research` — Web Researcher · `spec` — Spec Writer | Map structure with file:line references; cross-check ≥2 web sources with URLs; turn a vague ask into a testable spec. | `agents.ts:64-94` |
| **Build** — بناء | `data` — Data & Schema Specialist · `architect` — Architect · `implement` — Implementer · `general` — General Agent | Additive-first reversible migrations; decision-ready designs grounded in existing code; minimal clean diffs + build/typecheck. | `agents.ts:33-42`, `:97-116`, `:189-195` |
| **Quality** — جودة | `debugger` — Debugger · `perf` — Performance Engineer · `test` — Test Engineer · `review` — Code Reviewer · `refactor` — Refactoring Specialist · `security` — Security Auditor | Reproduce→isolate→minimal fix→regression proof; measure before optimizing with before/after numbers; tests that pin behaviour; findings by severity with file:line and fixes; behaviour-preserving small steps; exploitability-ranked security audit. | `agents.ts:43-62`, `:136-175` |
| **Ops** — عمليات | `devops` — DevOps Engineer · `docs` — Docs Writer · `skill-writer` — Skill Writer | Reproducible builds/CI/deps verified by running commands; docs that match code as it IS; extract one reusable skill from a transcript. | `agents.ts:117-134`, `:178-188` |

**Verdict: SHIPPED.** Subagents run in their own loop with a real per-subagent wall-clock budget; background subagents are capped and report via `background_done` events (`engine.ts:3609-3640`, `:996-999`, `:7321-7400`). Do not publish the cap number (§13).

---

## 5. The three signature instruments (`electron/agent/signatureFeatures.ts`)

All three are **pure functions**: no LLM call, no file write, no new IPC. Empty stores return explicit codes (`NO_LEDGER_DATA` / `NO_DNA_LEARNED` / `EMPTY_INTENT`), never sample rows (`signatureFeatures.ts:4-29`, `:361`, `:616`, `:817`).

| Instrument | Exact honest name (EN / AR) | What the developer gains | Evidence | Verdict |
|---|---|---|---|---|
| 1 | **Trajectory Replay** — إعادة تشغيل المسار | Rebuilds a run step-by-step from **three real ledgers**: session messages (real tool args + real outputs), the JSONL journal (real `ms` durations, milestones) and the trace (real output `chars`); each step names its own source, unpaired results are flagged, and no timestamp is invented for trace-only runs. | `signatureFeatures.ts:84-374` (engine), `docs/SIGNATURE-FEATURES-V1138.md:38-51` | **SHIPPED** |
| 2 | **DNA Autopsy** — تشريح الحمض النووي | Explains each **stored** fact: stored confidence, repetition count, the exact rule behind it, first/last seen, and real evidence linked by token overlap; its unique addition is `promptVisibleIds()` — the same selection rule the real prompt builder uses, so you can see whether a learned fact will reach the next system prompt. | `signatureFeatures.ts:376-628`, `:472-500` | **SHIPPED engine — DO NOT MARKET as a separate feature.** Per decision `docs/SIGNATURE-DECISION-V1140.md:13-27,103-115`, this UI was merged into the DNA rail page as "DNA Insights / رؤى الحمض" because it reads **the same** `dna.json` — it neither learns nor writes. Writers: describe it as an explanation lens inside DNA, not a third standalone instrument. |
| 3 | **Capability Compass** — بوصلة القدرات | Scores the **real 145-tool inventory** against typed intent, mines the tools' own "Do NOT use X — use Y" sentences into an auditable routing graph, joins real ledger call counts, and surfaces unused capabilities with verbatim hints and `unknownNames` — nothing is recommended outside `CORE_DEFS`. | `signatureFeatures.ts:630-828`, `:831-835`; `docs/SIGNATURE-DECISION-V1140.md:74-87` | **SHIPPED** |

**Writer note:** the honest public framing is "two unique instruments + a DNA explanation lens" (v1140 decision), not "three revolutionary AIs". Do not claim they are unique in the industry — session timelines and tool recommenders exist elsewhere; what is ours is the **three-ledger provenance join** and the **routing graph mined from the model's own tool descriptions**.

---

## 6. Scheduling & Flows (`scheduleService.ts`, `flowsService.ts`)

| Capability | What it really does / gain | Evidence | Verdict |
|---|---|---|---|
| **Persistent cron jobs (real cron worker)** | A job is stored atomically in `<userData>/schedules.json`; a live timer evaluates 5-field cron (with `@hourly`/`@daily`/… aliases); a due job fires the **same `runAgent` engine** headlessly, then a proof gate requires the workspace test suite to pass before the job may be called done. Jobs survive restart; `nextRun` is recomputed from cron on load; missed slots older than the lookback are skipped (no replay storm). | `scheduleService.ts:1-24`, `:186-206`, `:335-454`, `:456-476`, `:694-737`, `:969-1072`, `:284-312` | **SHIPPED** (tick/lookback/timeouts internal — §13) |
| **Four trigger kinds** | `cron`, `file-watch` (mtime + debounce), `webhook` (token-gated loopback `POST /trigger/<jobId>`), `ci-failure` (polls `gh run list`, fires once per failure id with a durable latch). Triggers are validated at creation instead of being silently discarded. | `scheduleService.ts:179-206`, `:478-543`, `:545-681` | **SHIPPED** (webhook token/secret never publish — §13) |
| **Observable jobs** | Durable event ledger (`schedules-events.json`) + per-job `runCount`, `consecutiveErrors`, `lastDurationMs`, `lastError`, `lastEvent`, exact `nextRun`; in-flight runs can be cancelled/paused; `schedulerStatus()` reports honest listener state. | `scheduleService.ts:76-108`, `:917-965`, `:1155-1188`, `:1243-1263` | **SHIPPED** |
| **Headless safety posture** | Auto-denies every approval, hard timeout, permission ceiling per job (`read` / `autoEdit` / `fullAccess`), workspace `MEMORY.md` injected, cost/token accounting; notification on every terminal result. | `scheduleService.ts:739-913`, `:766-777`, `:1013-1056` | **SHIPPED** |
| **Saved Flows (reusable prompts)** | A flow is a named prompt (global ≤50 / workspace ≤20) re-sent as a normal chat message with `runCount`/`lastRun` tracked; repeated typed prompts are detected and offered as "save as flow" with the **exact original text** preserved; duplicate-name and scope checks are enforced. | `flowsService.ts:1-17`, `:262-433`, `:443-525` | **SHIPPED** |
| **Replay validation** | A flow can be validated by a captured re-run of its stored command with an exit code and honest failure detail — a flow that fails replay is flagged, never silently activated. | `flowsService.ts:746-778` | **SHIPPED** (it is a captured shell replay, not a full model replay — do not overclaim) |

---

## 7. Real preview (`electron/services/previewService.ts`)

| Capability | What it really does / gain | Evidence | Verdict |
|---|---|---|---|
| **Static server with real port binding** | Serves a directory or a single file; binds the real server directly and retries upward on `EADDRINUSE` (no TOCTOU race); `index.html` opens directly, any other previewable artifact (pdf/image/media/md/text/code) gets a generated full-screen viewer, and a folder without `index.html` gets a directory listing. | `previewService.ts:99-130`, `:727-889`, `:1-25` | **SHIPPED** |
| **Artifact viewer with containment** | `/__surnia/view?src=…` + `/__surnia/raw/…` fetch real bytes with `realpath` containment, `nosniff`, and path-escape guards; SPA fallback for extension-less routes. | `previewService.ts:240-244`, `:577-628`, `:794-858` | **SHIPPED** |
| **Framework-aware dev server manager** | Starts the workspace's real dev runtime — `npm` (vite/next/nuxt/angular/svelte-kit/astro/CRA detection + `--port` parsing), Python (Django/FastAPI/Flask/entry scripts), Go (`go run .`) or a user custom command; finds the URL from output **and** polls the expected port as fallback (verifying it is HTTP, not a bare socket); streams clean log lines to the UI. | `previewService.ts:1133-1495`, `:1497-1685` | **SHIPPED** |
| **Auto-preview with real HTTP verification** | `findPreviewEntry()` finds the shallowest real web entry (index.html ≤3 levels, else dev script/Python/Go); `autoPreview()` starts a real server, makes a **real HTTP GET**, and returns a URL only when the entry actually answers — a bound-but-dead server is a failure, never a fabricated "ready". | `previewService.ts:913-1131`, `:977-1070` | **SHIPPED service — but see dead tool below** |
| **Live reload + port scan** | A debounced watcher emits `{kind:'watch'}` on file changes (node_modules/.git ignored, one retry if recursive watch unsupported); `scanPorts()` probes common dev ports; `devStatus()` also surfaces localhost URLs harvested from agent-started background processes. | `previewService.ts:1869-1961`, `:1802-1867`, `:1723-1776` | **SHIPPED** |
| **DEAD — agent-callable `preview_open`** | `autoPreview()` is exported for a `preview_open` tool and the dispatcher has `case 'preview_open'`, but **no `preview_open` def exists in CORE_DEFS** — the model cannot call it. Only the UI IPC path to `staticStart`/`devStart` is reachable. | executor `tools.ts:1642-1643`; absent from `tool-defs.ts:65-2485` | **DEAD — DO NOT MARKET "the agent opens a preview with one tool call".** Say: "the app previews the built page in a panel; the agent can start servers and take screenshots." |

---

## 8. CLI (`electron/agent/cli.ts`)

| Capability | Gain | Evidence | Verdict |
|---|---|---|---|
| **The same engine in a terminal** | `sadeem run "<task>"` runs one complete agent turn then exits; `sadeem` alone starts a multi-turn REPL with memory; both call the real `runAgent()` with the same 145 tools, approvals, DNA/playbook, subagents, compaction and report. No Electron binary needed (electron module stubbed). | `cli.ts:1-16`, `:124-164`, `:478-537`, `:539-574`, `:686-717` | **SHIPPED** |
| **Headless proof tooling** | `sadeem verify <proof.json> [--rerun]` checks the Ed25519 signature (public key embedded — verifiable on any machine with no key material), grades authenticity honestly, re-checks sha256 fingerprints against the current tree and can re-run the recorded test command; `sadeem journals` / `journal <id|latest>` read the crash-resilient run journals. | `cli.ts:576-630`, `:632-683`; `proof.ts:1-25` | **SHIPPED** |
| **Local-first credentials & utility commands** | `help / version / config / models`, permission modes, `--workspace`, images, `--yes`, `--quiet`; keys resolved flags → env → `~/.surnia/settings.json` (BYOK) and never printed. | `cli.ts:57-110`, `:166-226`, `:188-210` | **SHIPPED** (env var names internal — §13) |

---

## 9. Real MCP (`electron/agent/mcp.ts`)

| Capability | Gain | Evidence | Verdict |
|---|---|---|---|
| **Three real transports** | `stdio` (JSON-RPC over newline-delimited stdout/stdin), `http` (streamable-http with `mcp-session-id` echo, SSE-framed replies accepted), `sse` (legacy GET event-stream + POST to announced endpoint), all dependency-free (node child_process + fetch). | `mcp.ts:1-19`, `:76-102`, `:1459-1493` | **SHIPPED** |
| **Protocol negotiation + pagination** | Requests the current revision, negotiates down to older supported revisions, records serverInfo/capabilities, follows `tools/list` cursors (max 10 pages), answers server→client ping/progress/notifications. | `mcp.ts:71-83`, `:204-248`, `:2119`, `:1494-1565`, `:2222-2242` | **SHIPPED** |
| **Persistent pooled clients** | One live client per server reused across list/call (stateful servers survive between calls), idle TTL + LRU cap, health pings the live connection and auto-restarts crashed clients, full teardown on quit. | `mcp.ts:21-38`, `:1708-1984`, `:3137-3394` | **SHIPPED** (pool numbers internal — §13) |
| **MCP security posture** | Tool annotations parsed, description scanner for tool-poisoning (`suspicious` codes), per-server quarantine, per-tool enable/disable, destructive-call approval gate, tool-definition hash pinning with change→re-approval, and a call log — this layer enforces a remembered DENY while the engine owns the live approval card. | `mcp.ts:40-50`, `:1986-2030`, `:2330-2498`, `:2872-3074` | **SHIPPED** |
| **Full tool defs for every connected server** | `buildMcpToolDefs()` emits one real def per advertised tool (no slice), dispatch by exact emitted name, honest "not connected" error for a missing server. | `tool-defs.ts:2475-2486`, `:2511-2531`; `engine.ts:87-93` | **SHIPPED** |

---

## 10. Plugins (`electron/services/pluginService.ts`)

| Capability | Gain | Evidence | Verdict |
|---|---|---|---|
| **Real plugin manifests** | A plugin is a JSON manifest under `<userData>/plugins/<id>/plugin.json` contributing MCP server configs, real `/slash` prompts and bundled skills; install from a local `.json`, an `https://` URL (2MB cap, SSRF/loopback blocked), or a built-in starter catalog. | `pluginService.ts:1-26`, `:208-348`, `:515-628`, `:692-766` | **SHIPPED** |
| **Transactional enable/disable** | Validation happens before disk writes, ids are path-jailed, manifests are written atomically, and enable/disable reconciles MCP servers + slash-command files in one step with rollback on failure; ownership of command files is persisted so disable/uninstall removes only our files and survives restart. | `pluginService.ts:71-134`, `:142-176`, `:406-476`, `:630-690` | **SHIPPED** |
| **Starters are real capability packs** | Web Pack (fetch MCP + `/research`), Memory Pack (knowledge-graph MCP), Git Rituals (`/ship`, `/git-changelog`); nothing auto-installed; starters advertise their real contributions before install. | `pluginService.ts:692-766`, `:799-813` | **SHIPPED** |

---

## 11. Context Lens, usage & effort (`src/store.ts`, `src/components/ContextLens.tsx`, `src/lib/modes.ts`)

| Capability | Gain | Evidence | Verdict |
|---|---|---|---|
| **Context Lens — honest context meter** | A radial indicator shows the model's context-window fill, cache read/write/fresh segments when the provider reports them (otherwise the honest total **only** — no invented "system/tools/files" slices), session cost, source label (`Exact` vs `Estimated`), and a "Compact now" action; live streaming shows a marked `≈` estimate replaced by exact usage on completion. | `ContextLens.tsx:1-9`, `:29-42`, `:50-74`, `:82-130`; `store.ts:834-839`, `:878-887` | **SHIPPED** |
| **Exact usage ledger** | Per-turn DELTA drives the context ring; cumulative run totals (all rounds + all attempts) drive the Usage view; `sum(per-message) == session total` reconciles; missing provider usage is flagged `estimated` and rendered with `≈`. | `store.ts:4364-4469`, `:822-833`, `:2152-2180` | **SHIPPED** |
| **Effort toggle** | `/effort` switches `standard` ↔ `deep`; deep gives **2× the step budget** and thinking-first execution — a real engine effect, not a label. | `store.ts:3772-3787`; `engine.ts:3705-3706` | **SHIPPED** (the 2× factor is user-facing and may be stated) |
| **Tool profiles are a view, not a gate** | 9 selectable profiles change what is **advertised** for a turn; dispatch always resolves the full registry, so any tool name from any profile is callable — nothing is deleted or permission-gated by a profile. | `modes.ts:322-420`; `engine.ts:3705-3706` | **SHIPPED** |

---

## 12. Website corrections — what is wrong or inane now, and what to say instead

> I was not given the final copy deck; this section reads the **live website source** (`website/app/page.tsx`, `website/app/features/page.tsx`) plus the founder's complaint. Apply the same rule to any new copy: replace adjectives with a checkable mechanism.

| Current website line / claim | Source | Problem | Say instead (grounded, studied) |
|---|---|---|---|
| "145 real tools behind **three clear profiles** … Nothing is deleted — the model simply sees the right shelf" | `page.tsx:175-180`, `features/page.tsx:81` | The "three profiles" framing is wrong/understated: there are **9 selectable profiles**, and the important truth is stronger — profiles only change what is **advertised**; strong models are advertised all 145, and **every tool stays callable by name from any profile**. | "145 real tools with schemas and routing descriptions. Profiles change what the model sees for a turn, never what it may call — any tool stays callable by name. Strong models see the full registry." (`modes.ts:322-420`, `tool-defs.ts:65`, `tools.ts:1467-1956`) |
| "It remembers what worked." / "The Living Playbook … advisory, reversible, yours." | `page.tsx:164-171`, `features/page.tsx:156-158` | Directionally right but thin — it omits *what* persists and *why it cannot backfire*. | "After real runs the app writes worked / failed / preferences / verified recipes to `PLAYBOOK.md` and keeps a versioned history with diffs; the next run reads it as advisory defaults — the current request always overrides it, and learned facts never become bans." (`playbook.ts:1-21`, `:316-338`, `:345-412`; `dna.ts:652-656`) — Arabic: «يتذكّر ما نجح وما فشل في ملف PLAYBOOK.md، ويعرض سجلّ إصدارات مع فروق، ويقرأه كتوجيه لا كقاعدة.» |
| "The signature feature" (singular, applied to Playbook) | `features/page.tsx:158` | There are three signature **instruments** (`signatureFeatures.ts:831-835`) and the playbook is one of several learning surfaces. Calling one "the signature feature" is the generic-superlative habit the founder rejected. | Name surfaces plainly: **Living Playbook** (writes a file), **Trajectory Replay** (rebuilds a run from three real ledgers), **Capability Compass** (scores the real 145-tool inventory against an intent). Mention DNA Autopsy as "DNA Insights" inside the DNA page, not a fourth standalone feature (`docs/SIGNATURE-DECISION-V1140.md`). |
| "Proof-gated schedules … a job is only called done when its proof — test runs, diffs and verification — is present." | `features/page.tsx:218-220` | Mostly true, but vague about the gate. | "A cron job runs the same agent engine headlessly; the result is suppressed if the workspace test suite fails after the run, and every fire is recorded in a durable event ledger with exact next-run time, error count and duration." (`scheduleService.ts:969-1072`, `:917-965`) |
| "Bring your own key… no telemetry… start free without an account" | `page.tsx:157-162` | "No telemetry" is directionally right for provider calls (direct from app), but there is a local license/gate subsystem; do not make absolute privacy promises you cannot prove. | "Credentials are stored locally (BYOK) and provider calls go directly to the chosen provider; the app's own learning files are plain markdown/JSON on your machine that you can read, edit or delete." (`cli.ts:13-15`, `dna.ts:14-18`, `playbook.ts:316-338`). Avoid absolute "no telemetry" unless the parent confirms it. |
| "A real debugger … attach over DAP" | `features/page.tsx:239` | True; keep it, but ground it. | Name the real controls: breakpoints, live variable inspection, expression evaluation, stepping — via the `debug_*` tool family and DAP (`tools.ts:1796-1806`, `debugTools.ts`). |
| Any "the AI understands / thinks / never stops / uses every tool automatically" | generic hero copy | Not a mechanism; the engine enforces gates but model choice is not guaranteed. | Replace with: "the harness checks the model's claims against actual files, commands and tests, and reports partial work as partial" (`engine.ts:4227-4269`, `:4912-4950`). |
| "100% LOCAL" stat with no qualifier | `page.tsx:192` | True for credentials/learning files; wrong if read as "no network at all" (web tools, MCP, provider calls are network features). | "LOCAL-FIRST — your keys and learning files stay on your machine; provider calls go directly to your chosen provider." |

**Recommended truth spine for the rewrite (one paragraph, no adjectives):**
> SADEEM is a local-first coding agent with 145 schema'd tools and the same engine in its desktop app and CLI. It runs long tasks with automatic continuation, compaction at the model's real context window, approval modes, persistent checkpoints and a proof pipeline that checks claims against files, commands and tests. After real runs it writes a versioned `PLAYBOOK.md` and a persistent user model, both advisory and editable. It also runs cron jobs with a test-suite proof gate, drives real previews and dev servers, speaks MCP over three transports, and installs plugins that contribute MCP servers and slash commands. Everything the site claims is a file:line in this document.

---

## 13. INTERNAL details that must NEVER appear on the public website
## ١٣. تفاصيل داخلية يجب ألا تظهر أبداً في الموقع العام

The founder explicitly named these categories; the list below is the concrete inventory found in source. Writers: **never reproduce these strings, numbers or filenames in marketing copy.** Docs for engineers may keep them; the website may not.

**A. Internal build / version staging / hashes**
- Engine build tags and version staging: `ENGINE_VERSION = 'v3.1.0-engine'` (`engine.ts:136`), MCP `CLIENT_INFO.version = '3.1.0'` (`mcp.ts:84`), internal wave names (v1132/v1135/v1138/v1140/v1143…), "staged publishing" / "manual-update notes" / release SHA-256 figures / checksum grids / `sadeem verify --legacy-key` (`cli.ts:583-617`).
- Release provenance hashes, signing private key paths, `known_keys`, `SADEEM_VERSION` env override (`cli.ts:35`) — never print.

**B. Environment variables / secret names / credential mechanics**
- `SURNIA_MAX_RUN_MS`, `SURNIA_TIME_CAP_GRACE_MS`, `SURNIA_MAX_CONTINUE_ROUNDS`, `SURNIA_TURN_RETRY_DELAYS_MS`, `SURNIA_STREAM_CONTINUE_BUDGET`, `SURNIA_MAX_TOKENS_CONTINUES`, `SURNIA_PAUSE_CONTINUES`, `SURNIA_LIVENESS_PULSE_MS`, `SURNIA_DEBUG_HEADLESS`, `SADEEM_CLI_DEBUG`, `SADEEM_TEST_USERDATA`, `SADEEM_CLI_YES` (`engine.ts:162-275`, `cli.ts:35-104`, `scheduleService.ts:850`, `pluginService.ts:62`).
- Credential env names and resolver order: `KODEX_API_KEY`, `KODEX_BASE_URL`, `KODEX_MODEL`, `KODEX_PROVIDER`, `KODEX_MODE`, `SURNIA_HOME`, `KODEX_HOME`, `~/.surnia/settings.json` precedence, `maskKey()` (`cli.ts:38-39`, `:75-91`, `:152-154`, `:182-186`).
- Webhook install token file, `?token=` query secret, `schedules-token`, `schedules-ci-fired.json`, redaction internals (`scheduleService.ts:151-177`, `:545-584`, `:623-650`); MCP OAuth secret handling, `mcp-v2.json`, signing key store (`mcp.ts`, `proof.ts:9-15`).

**C. Debug thresholds / tuning numbers (real, but internal)**
- Loop tuning: `DEFAULT_MAX_TURNS=120`, `SUBAGENT_MAX_ITERATIONS=24`, retry delay ladder `[200,400,600,800,1000,1200]`, liveness cadence 1.5s, context-load 500ms, mention caps, compaction threshold 90% math / `CHARS_PER_TOKEN=3.5`, `STAGNANT_TURNS_THRESHOLD=6`, `DOOM_LOOP_THRESHOLD=3`, `GOAL_CONTINUE_ROUNDS=30`, background subagent cap 64 (`engine.ts:149-281`, `:942-1019`, `:996`).
- Budget numbers: 24 verdicts / $1.50 / 30min baseline; 96 / $5 / 120min long-run; `maxOutputContinues=25`, `maxPauseContinues=50` (`budget.ts:36-47`, `engine.ts:199-209`).
- DNA/playbook internals: 60 active patterns, 40 feedback, 8/4 prompt slots, 2000-char prompt budget, 21-day half-life, 56-char similarity prefix, 12/10 transcript extract messages, caps `TEXT_CAP=240` (`dna.ts:43-73`, `:592-608`; `playbook.ts:33-41`; `signatureFeatures.ts:384-389`).
- Scheduler internals: 30s tick, 30min run cap, 90min lookback, 100 jobs, 64KB buffer, 50 events, webhook port 7681, 5s/5min debounces (`scheduleService.ts:44-53`, `:612`).
- Preview internals: 40-port retry ceiling, 20s/45s/8s caps, 6 agent URLs, 250ms/400ms debounces, port lists (`previewService.ts:99-130`, `:1591-1601`, `:1665-1680`, `:1724-1725`, `:1805-1808`, `:1872`).
- MCP/plugin internals: 120s startup / 30s probe / 300s call timeouts, 8 pooled clients / 5min TTL / 60s health, 2MB plugin cap, 16 MCP + 32 prompts per plugin, 64KB prompt body, 20s URL download timeout (`mcp.ts:85-102`, `:1708-1709`, `:3137-3141`; `pluginService.ts:35-42`, `:581-620`).
- Any "429/5xx refund" internals, taint labels, `red_green`/mutation verdict codes, `falseDone` rates as internal telemetry (`engine.ts:4046-4065`, `:4448-4605`).

**D. Billing / licensing / entitlement state**
- `checkGate('subagent'|'device'|'parallel')` gates in `tools.ts:3612`, `:3926`, `:5632` and `engine.ts:1908-1911`; `checkGate` import `engine.ts:75`; `licenseService`, `billingService`, entitlement caches, offline grace, "PRO contract", "FREE SEASON" internal gating (`docs/MARKETING-COPY-EN-V1139.md`, `docs/REVENUE-V1142.md`, `docs/LICENSE-SECURITY-V1133.md`). Never expose "billing state", tier mechanics, or gate names on the public site.

**E. Internal state filenames / IPC plumbing**
- `.surnia/playbook.json`, `playbook-history.json`, `dna-stats.json`, `flows.json`, `flows-corrections.json`, `mcp-v2.json`, `schedules-events.json`, `.command-owners.json`, `plugin__<id>__*` legacy names, `kdx:*` IPC channels, `ipcMain.handle`, electron stub details, `userData` paths (`playbook.ts:34-36`, `dna.ts:40-41`, `flowsService.ts:27-31`, `pluginService.ts:42`, `scheduleService.ts:210-220`, `cli.ts:37-55`).
- Exception already on the site and **safe to keep**: `PLAYBOOK.md` as the user-visible, editable markdown artifact; describing "local files you can read/edit/delete" is fine. Do not add the sidecar/history filenames.

**F. Stale/liminal test-harness language**
- Any sentence from internal verdict docs — "AI DOES NOT ACTUALLY WORK YET", "3 of 7 reality checks FAIL", "green tests mask UX failures", "partial — advice not enforcement", "not wired into the running app yet" (`docs/AI-REALITY-V1132.md:10-18`, `docs/MEMORY-CONTINUITY-V1135.md:25`). These are engineering records, not website copy. They justify the *humility* of the rewrite, never its claims.

---

## 14. Final honesty checklist for the writer

- Every number on the site must be one of: 145 tools · 16 specialists · 12 providers · 3 instruments (with the v1140 merge) · 2× deep-effort step budget. Nothing else.
- Every claim must name a mechanism a developer can verify (a file, a gate, a tool call, a real HTTP GET), not a quality adjective.
- Mark work as partial when it is: proof/schedules are gated by tests; MCP calls need opt-in; browser tools need the browser runtime; `gh`/LSP/external QA tools need local installs; tool *choice* is model behaviour.
- Do not mention `preview_open` or `worktree_list` as agent capabilities (dead, §2/§7).
- Do not present DNA Autopsy as a separate "learning" feature (§5).
- If a capability is marked INTERNAL ONLY in §13, leave it out even if it is impressive.
