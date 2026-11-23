# COMPETITOR CAPABILITIES & HONEST GAP TABLE — SADEEM v11.34
# قدرات المنافسين وجدول الفجوات الصادق — سديم v11.34

> Reverse-engineering of **public, official documentation only** (no proprietary
> prompts, no invented features). Research + implementation subagent, 2026-11-21.
> Owned files: `electron/agent/prompts.ts` (+ this doc). Engine / tools / store
> were **not** edited.
> هندسة عكسية من **وثائق رسمية عامة فقط** (لا برومتات داخلية، لا ميزات مختلقة).
> الملفات المملوكة: `electron/agent/prompts.ts` + هذه الوثيقة. لم أعدّل المحرك أو الأدوات أو المتجر.

---

## 0. The blunt verdict first / الحكم الصريح أولًا

**EN:** The founder's premise — "the app is weak in intelligence, prompt, engine
and tools" — is only **partly** true, and the weak part is not what it looks like.
Of the 17 advertised capabilities below, **SADEEM already really implements 14**.
The tools are real (146 registered, 146/146 reachable, 117 named by the prompt),
plan/debug/review/hooks/subagents/MCP/skills/checkpoints/LSP/worktrees/approvals/
flows+schedule all exist in shipped source. The genuine gaps are **hook event
breadth (2 events vs Claude Code's 30+), cloud/remote execution (absent by
local-first design), and session-sharing links**. Everything else is a
**prompt-salience problem**, not a missing feature: a weak model sees a 145-name
registry and answers "I can't" or grabs a generic tool. The v11.34 fix is a short
intent-grouped `CAPABILITY ROSTER` in the byte-stable prefix — not a new feature.

**AR:** فرضية المؤسس («التطبيق ضعيف في الذكاء والبرومت والإنجن والتولز») صحيحة
**جزئيًا**، والضعف ليس حيث يبدو. من أصل ١٧ قدرة أدناه، **سديم يُنفّذ ١٤ فعلًا**.
الأدوات حقيقية (١٤٦ مسجّلة، ١٤٦/١٤٦ قابلة للاستدعاء، ١١٧ يذكرها البرومت)،
والتخطيط/التصحيح/المراجعة/الخطافات/الوكلاء الفرعيون/MCP/المهارات/nقاط الاستعادة/
LSP/الورك تري/الموافقات/التدفقات والجدولة كلها موجودة في الكود المنشور. الفجوات
الحقيقية: **اتساع أحداث الخطافات (حدثان مقابل ٣٠+ عند Claude Code)، التنفيذ
السحابي (غائب بتصميم محليّ-أول)، وروابط مشاركة الجلسات**. الباقي مشكلة
**بروز في البرومت (salience)** لا ميزة ناقصة: النموذج الضعيف يرى ١٤٥ اسم أداة
فيجيب «لا أستطيع» أو يختار أداة عامة. إصلاح v11.34 هو قسم `CAPABILITY ROSTER`
قصير مجمّع حسب النية داخل البادئة الثابتة بايتًا — لا ميزة جديدة.

---

## 1. Sources actually fetched / المصادر التي تحقّقتُ منها فعلًا

| Product | Official doc | URL | What it advertises |
|---|---|---|---|
| Claude Code | Overview | https://docs.claude.com/en/docs/claude-code/overview (canonical: https://code.claude.com/docs/en/overview) | terminal/IDE/desktop/web; plan the approach → write across files → verify; commits & PRs; MCP; CLAUDE.md/AGENTS.md + auto memory; skills; hooks; parallel subagents + background agents + Agent SDK; scheduled cloud/desktop tasks + `/loop`; worktrees; Remote Control/teleport; channels; GitHub Actions/GitLab CI; code review; Chrome debugging; dynamic workflows |
| Claude Code | Hooks reference | https://code.claude.com/docs/en/hooks.md | 30+ lifecycle events (`SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`, `PreCompact`, `SubagentStart/Stop`, `WorktreeCreate/Remove`, permission events…); 5 handler types (command, HTTP, MCP tool, prompt, agent); subcommand `if` matchers; async hooks |
| Claude Code | Common workflows | https://code.claude.com/docs/en/common-workflows.md | "Plan before editing" (read-only until approval), "Delegate research to subagents", "Run parallel sessions with worktrees", resume sessions (`--continue`/`--resume`), pipe into scripts |
| OpenCode | Intro / docs | https://opencode.ai/docs/ | TUI + desktop + web; `opencode pair` one-time link to the web UI; providers; plugins; MCP servers; custom commands; config |
| OpenCode | Agents / permissions / tools / config | https://opencode.ai/docs/agents/ , https://opencode.ai/docs/permissions/ , https://opencode.ai/docs/tools/ , https://opencode.ai/docs/config/ | `build`/`plan`/`general`/`explore` agents; allow/ask/deny rules with shell-subcommand scanner; `execute` (Code Mode); compaction; skills; instructions |
| Codex | Cloud | https://developers.openai.com/codex/cloud/ | each cloud task has its own workspace, keeps working while your computer is asleep; review changed files, request follow-ups, commit/open a PR; published reusable environments; network secrets; start cloud work from the CLI |
| Codex | Permission modes | https://developers.openai.com/codex/permission-modes | *Ask for approval* / *Approve for me* (auto-approve mode) / *Full access* / *Custom (config.toml)*; `workspace-write` sandbox + `on-request` approvals policy; separate sandbox vs approval controls |
| Codex | Skills & plugins, working with agents | https://developers.openai.com/codex/skills-and-plugins , https://developers.openai.com/codex/working-with-agents | reusable skills/plugins, agent orchestration foundations |

> Honesty note: `websearch` returned 402 in this environment, so all facts above
> came from direct `webfetch` of the official pages. Claude Code's "checkpoints"
> capability is widely advertised in its docs but was **not** re-fetched
> line-by-line this round — it is marked as such in the table.
> ملاحظة أمانة: بحث الويب أعاد 402، لذا كل الوقائع أعلاه من `webfetch` مباشرة
> للصفحات الرسمية. ميزة «نقاط الاستعادة» عند Claude Code مشهورة في وثائقه لكنها
> **لم تُجلب** سطرًا بسطر في هذه الجولة — وُسمت بذلك في الجدول.

---

## 2. Honest gap table / جدول الفجوات الصادق

Legend: **HAS** = real, reachable implementation · **PARTIAL** = present but
narrower than the competitor · **GAP** = genuinely absent · **N/A** = intentional
by local-first design.
المفتاح: **موجود** = تنفيذ حقيقي قابل للاستدعاء · **جزئي** = موجود لكن أضيق
· **فجوة** = غائب فعلًا · **لا ينطبق** = غائب عمدًا بتصميم محليّ-أول.

| # | Capability | Competitor has | SADEEM has (file:line) | Verdict / missing-weak |
|---|---|---|---|---|
| 1 | Plan mode (read-only → approval) | Claude Code `--permission-mode plan` / common-workflows; OpenCode `plan` agent | `electron/agent/prompts.ts:120-124` (MODE_NOTES.plan), `:156-179` (TASK_MODE_SPECS.plan, hard `readOnly:true` + `denyHint`), `electron/agent/tool-defs.ts:984` (`propose_plan`) | **HAS** — arguably stricter (harness-enforced, plan.md as the single sanctioned write). Weak = model sometimes skips `propose_plan` → salience. |
| 2 | Debug / review modes + structured report | Claude Code workflows; Codex review | `prompts.ts:180-204` (debug + review protocols; review persists `.surnia/reviews/review-<stamp>.md`), `:210-213` (registry) | **HAS** (auto verify→fix→re-verify loop is extra). |
| 3 | Hooks (lifecycle automation) | Claude Code 30+ events, 5 handler types (HTTP/MCP/prompt/agent/async) | `electron/agent/hooks.ts:42-56,300-325` (PreToolUse blocks on exit 2, PostToolUse annotates), `electron/agent/engine.ts:6134-6142,6220-6233` (wired) | **PARTIAL — genuine gap in breadth**: only `PreToolUse`/`PostToolUse`. No SessionStart/Stop/PreCompact/WorktreeCreate/HTTP/agent hooks. Not a missing *feature*, a missing *event surface*. |
| 4 | Subagents / background agents | Claude Code subagents + background agents + Agent SDK; OpenCode subagents | `electron/agent/agents.ts:1-6,22+` (16 specialists, 3 research, own loops + tool restrictions); `task` tool in `tool-defs.ts`; `prompts.ts:830-836` roster | **HAS** (we expose the roster by name; OpenCode hides its agents behind Code Mode). |
| 5 | MCP | all three | `prompts.ts:971-981` (dynamic `mcp__<server>__<tool>` list, opt-in, sequential chaining, cross-server recipes), `prompts.ts:619-621` | **HAS**. |
| 6 | Skills | Claude Code skills; Codex skills & plugins | `prompts.ts:983-992` (SKILLS-FIRST rule), `tool-defs.ts:1003-1018` (`use_skill`/`create_skill`), bundled `electron/assets/skills/*` | **HAS**. |
| 7 | Checkpoints / rewind | Claude Code (advertised; not re-verified this round) | `tool-defs.ts:819` (`checkpoint_save`), `prompts.ts:811` (save before risky edits / `checkpoint_restore`) | **HAS**. |
| 8 | Extended thinking | Claude Code; Codex reasoning | `prompts.ts:45-46,733-741` (`effort:'deep'` → thinking-first directive), `electron/agent/providers.ts:38-41,152-155,251-252` (thinking blocks + `reasoning` mode pass-through) | **HAS**. |
| 9 | LSP code intelligence | Claude Code code-intelligence plugins; OpenCode LSP | `electron/agent/lspLanguages.ts` (shared registry; ≥12 wired servers + ≥10 heuristic fallbacks ≈ 16+ languages), `tool-defs.ts:1173,2239` (`lsp_*`, `lsp_languages`); `tests/v1116-lsp-languages.test.mjs` | **HAS** (16+ languages, honest "install X" errors). |
| 10 | Worktrees | Claude Code `--worktree`; Codex managed worktree tools (create-worktree, status polling, .worktreeinclude) | `tool-defs.ts:751-773` (`worktree_create`/`worktree_remove`), `electron/services/gitService.ts:337,414,427,443` (list/create + safe `copyWorktreeInclude`), `docs/REVERSE-ENG-CODEX-v10.2.md:17-35,53-62` | **HAS** (we intentionally skipped async create/status polling — sync git is fast here). |
| 11 | Approvals / permission modes | Codex 4 modes + sandbox/approval split; OpenCode allow/ask/deny + "allow always" | `prompts.ts:119-129` (4 permission modes + AR gloss `:216-221`), `prompts.ts:281-312` (`.surnia/policy.json` deny/allow), `electron/services/approvalPolicyService.ts`, engine gate | **HAS** (policy file + read-only task modes give comparable or finer control). |
| 12 | Flows / scheduled tasks | Claude Code cloud + desktop scheduled tasks + `/loop` | `electron/services/flowsService.ts:1-7` (saved prompt, manual replay), `electron/services/scheduleService.ts:1-12,31,456-579,592-665` (headless cron + **proof gate**: failed test suite suppresses the success notification); evidence in `docs/FLOWS-SCHEDULE-TRUTH.md:111-129` | **HAS** — with a stronger honesty gate than the competitors advertise. |
| 13 | Sessions: resume / branching / history | Claude Code `--continue`/`--resume`, session picker | `src/store.ts` sessions + durable `journals/<date>/<session>.jsonl` + `traces/<date>/trace-*.jsonl` (evidenced in `docs/CAPABILITIES-V1126.md:67-69`) | **HAS**. |
| 14 | Browser / UI verification, image work | Claude Code Chrome debugging; OpenCode browser tools | `prompts.ts:763-767,776-789,727-729` (`browser_*`, `preview_screenshot`, `ui_quality_check`, `lighthouse`, `e2e_run`, `a11y_audit`, `image_generate`, `image_edit`, `media_ffmpeg`, builders) | **HAS** — broader than the competitors' advertised browser set. |
| 15 | Cloud tasks / remote execution | Codex Cloud (own workspace, runs while PC asleep); Claude Code web/cloud + Remote Control | — | **GAP / N/A**: no cloud runner. Local-first Electron with the user's own key. Adding a remote executor is a product decision, not a prompt fix. |
| 16 | Session sharing links | OpenCode `opencode pair` (one-time link → web UI); Claude Remote Control | `electron/preload.ts:229` — standalone **HTML export** (save dialog), not a live share link | **GAP**: no share/join session link. Honest: this is the only clear "competitor has, we don't" UI capability besides cloud. |
| 17 | Code Mode (`execute`) | OpenCode `execute` — JS that calls tools in parallel, keeping intermediates out of context | Code Mode runtime exists in the harness (`execute` tool inside the Code Mode sandbox); **not** one of the 146 model-callable registry tools | **PARTIAL / different surface**: context economy exists (batching reads, `recall_result`, compaction) but not exposed as a first-class model tool. |

**Count:** HAS = 14 · PARTIAL = 2 · GAP/N/A = 2 (rows 15–16; row 17 partial overlaps row 3's theme).
**العد:** موجود = ١٤ · جزئي = ٢ · فجوة/لا ينطبق = ٢.

---

## 3. What actually changed / ما تغيّر فعلًا

`electron/agent/prompts.ts` — the `TOOL STRATEGY` block (~line 792) was replaced by
a **byte-neutral** block that keeps its heading and adds a compact, intent-grouped
`CAPABILITY ROSTER` with **exact registry tool names**:

```
# CAPABILITY ROSTER — intent → exact names (tool_help for args)
- READ / WRITE / RUN / WEB / IMAGE-BUILD / MCP / VERIFY-SUBAGENT
```

Why this shape:
- Weak models cannot act on a flat 145-name list; grouping by **intent** (`read`,
  `write`, `run`, `web`, `image`, `mcp`, `subagent`, `verify`) matches how a task is
  phrased, so the right tool is one hop away.
- It names **only real tools** — the v1131 audit rejects any invented snake_case
  token. Verified: `SUSPICIOUS=[]`, 117 real tool names present in the rendered prompt.
- It is **word-stable** and lives in the byte-stable static prefix → provider
  prompt cache still hits; no dynamic interpolation.
- It **replaces** the old verbose strategy prose instead of piling on, so the
  net byte change is **−7 B**. No new "wall of names".

---

## 4. Verification (honest, with the concurrent-agent caveats) / التحقق (صادق)

| Check | Result |
|---|---|
| Rendered EN prompt bytes | **24425 B** (was 24432; net **−7**) |
| v11.16 cap (`< 24 KB`) | PASS |
| v11.21 cap (`size − 23754 ≤ 700`) | **PASS — +671** |
| v11.23 cap (`size − 24381`, `0 ≤ net < 400`) | **PASS — +44** |
| `tests/v1116-prompt-cache.test.mjs` | **11/11 PASS** |
| `tests/v1121-ai-quality.test.mjs` | **6/6 PASS** |
| `tests/v1123-prompt-accuracy.test.mjs` | **7/7 PASS** |
| `tests/v1131-prompts.test.mjs` | **7/8** — the only failure is a hardcoded `registry.length === 145` assertion while the live registry is **146** (a tool was added by the tools-agent concurrently). My tool-name audit passes (`SUSPICIOUS=[]`). Not caused by, and not fixable from, `prompts.ts`. |
| `tests/v1132-prompt-real.test.mjs` | **7/7 PASS** |
| `tsc --noEmit` (renderer) | **PASS** (no errors) |
| `tsc -p tsconfig.node.json --noEmit` | one unrelated error: `electron/agent/engine.ts:4847` — `Cannot find name 'contextWindowFor'` (engine.ts is owned by another agent). |
| Tool-name audit (all conditional sections on) | `REGISTRY_COUNT=146`, `SUSPICIOUS=[]`, `MENTIONED=117` |

**Do not** "fix" the two red lines by editing `tools.ts` or `engine.ts` from this
subagent — they belong to other owners and were already drifting at write time.
**لا تُصلح** السطرين الأحمرين بتعديل `tools.ts` أو `engine.ts` من هذا الوكيل —
هما مملوكان لجهات أخرى وكانا يتغيّران وقت الكتابة.

---

## 5. Honest limitations / حدود البحث

- Public docs describe the *advertised* surface; internal prompt text and exact
  hook schemas were not requested and are not claimed here.
- No feature was invented. Where SADEEM is weaker (hook event breadth, cloud,
  share links), the doc says so plainly.
- A system prompt can only steer behavior: the roster improves **salience**, it
  cannot force a weak model to reason better. The honest fix for "intelligence"
  is model choice + verification loops (already present), not more prompt text.
- الوثائق العامة تصف السطح **المُعلَن**؛ لم أدّعِ معرفة البرومت الداخلي أو
  المخططات الدقيقة. لم أختلق أي ميزة. البرومت يوجّه السلوك فقط: القائمة تحسّن
  **البروز** ولا تجعل النموذج الضعيف يفكر أفضل؛ علاج «الذكاء» الحقيقي هو اختيار
  النموذج + حلقات التحقق (موجودة أصلًا)، لا مزيد من النص.
