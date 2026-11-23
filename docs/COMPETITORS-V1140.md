# COMPETITORS V1140 — Kilo Code + Augment Code vs SADEEM
# المنافسون — كايلو كود وإيجومنت كود مقابل سديم

> Research + decision-support subagent, 2026-11-22. **Official public docs only.**
> No proprietary prompts, no screenshots guessed, **no invented features**.
> Source files were read read-only; this wave wrote **this document only**.
> هندسة عكسية من **الوثائق الرسمية العامة فقط** — لا برومتات داخلية، لا ميزات
> مختلقة. لم أعدّل أي ملف كود؛ كتبتُ هذه الوثيقة فقط.

---

## 0. الحكم الصريح أولًا / The blunt verdict first

**AR:** المؤسس طلب «منافسين آخرين»: كايلو كود (Kilo Code) وإيجومنت كود
(Augment Code). الحقيقة بعد جلب وثائقهما الرسمية: **سديم لا يتأخر عنهما في
معظم الوظائف التي يطلبها المستخدم**. الخلل الحقيقي ليس في الكود بل في
**البروز (salience) و«الشاشة الأولى»**: لدينا ١٤٥ أداة وتعلمًا مستمرًا
وتحققًا، لكن المستخدم الجديد يرى أولًا بوابة حساب ثم شاشة إعدادات ثم نافذة
اختيار مجلد قبل أن يرى أي قيمة. كايلو يقول «اكتب ما تريد بلغة عادية» من أول
نقرة؛ إيجومنت يفتح «Project Home Page» فيه ملخص مولّد للمشروع تلقائيًا عند
أول إعداد. نحن نفتح نموذجًا. هذه مشكلة تصميم/onboarding، لا مشكلة ذكاء.

**EN:** Both competitors heavily overlap with SADEEM. Kilo Code is open-source
(MIT), has 500+ models at zero markup, BYOK, local models, Desktop (GA) + VS
Code + JetBrains + CLI + Cloud + Slack + Mobile, specialized agents
(Code/Plan/Debug/Ask + Code Reviewer + Security), an "agent command center",
parallel isolated worktrees, Auto Model routing (Efficient/Frontier/Free),
prompt & context visibility, no silent model switching, 5M+ users — and was
acquired by Anaconda in 2026. Augment is a cloud/enterprise platform (Cosmos,
Experts, Context Engine, code review, memory, automations). **Do not claim
SADEEM is first or unique at any of that.** What SADEEM genuinely has that
they do not advertise in the same form: a local, user-owned continuously
self-updating DNA model with confidence + prompt-visibility proof; a visible
145-tool roster with a mined routing graph and real coverage; child-session
drill-in; per-model effort control; and the two remaining signature
instruments (three-ledger replay + capability compass). What they have and we
plainly lack: IDE extensions, cloud agents, hundreds of models, an MIT public
repo, and live session-sharing links.

---

## 1. المصادر الرسمية التي جُلبت فعلًا / Official sources actually fetched

| Product | Official URL | What it advertises |
|---|---|---|
| Kilo (home, verified live) | https://kilo.ai/ | MIT open source; 500+ models, zero markup; BYOK + local models; Desktop GA + VS Code + JetBrains + CLI + Cloud + Slack + Mobile; Code/Plan/Debug/Ask agents, Code Reviewer + Security agent; agent command center; parallel isolated worktrees; Auto Model (Efficient/Frontier/Free); prompt & context visibility; no silent model switching; 5M+ users; acquired by Anaconda (2026) |
| Kilo docs home | https://docs.kilo.ai/ → https://kilo.ai/docs/ | Get Started / Code with AI / Customize / Collaborate / Automate / Deploy & Secure / Gateway / Desktop |
| Kilo overview | https://kilo.ai/docs/getting-started | IDE/CLI/Web&Mobile/Slack; Code, Plan, Debug, Ask + custom agents; Autocomplete; share sessions; reviews; deploy & secure; "easiest way to configure is to ask the agent" |
| Kilo first task | https://kilo.ai/docs/getting-started/quickstart | Open sidebar chat → type plain English → Enter → **most tools auto-approved by default**; shell/external-dir/sensitive reads ask; Settings → Auto-Approve = Allow/Ask/Deny |
| Kilo chat interface | https://kilo.ai/docs/code-with-ai/agents/chat-interface | Input box + action buttons + agent dropdown + session management; `@` mentions; session tabs; suggested answers via `question` tool; `/export`; Mermaid/charts inline; status colors |
| Kilo agents | https://kilo.ai/docs/code-with-ai/agents/using-agents | `code` (full tools), `ask` (read-only), `plan` (read-only + `.kilo/plans/`), `debug` (full); custom agents; no built-in Review agent in VS Code/CLI |
| Kilo collaborate | https://kilo.ai/docs/collaborate | Platform-agnostic sessions; **read-only share links**, fork shared sessions; Teams/Enterprise, audit logs, SSO, adoption dashboard |
| Kilo customize | https://kilo.ai/docs/customize | Custom modes/rules/instructions/subagents/permissions, agents.md, workflows, skills, prompt engineering; codebase indexing, context condensing, Memory, `.kilocodeignore` |
| Kilo automate | https://kilo.ai/docs/automate | AI PR reviews (Strict/Balanced/Lenient; security/performance/bugs/style/tests/docs); Agent Manager with worktree-isolated sessions; MCP (STDIO/SSE); GitHub Actions; scheduled scans |
| Augment home | https://www.augmentcode.com/ | Cosmos "software factory", agent loops (code review, ticket→PR, vulnerability remediation, incident response), triggers from GitHub/GitLab/Slack/Linear/Jira/schedules/webhooks, managed cloud sandboxes + self-hosted |
| Augment docs index | https://docs.augmentcode.com/ + https://docs.augmentcode.com/llms.txt | Full official page index (used to discover the pages below) |
| Augment intro | https://docs.augmentcode.com/introduction.md | AI-native coding platform: coding agents, deep codebase intelligence, flexible automations |
| Augment Project Home Page | https://docs.augmentcode.com/using-augment/home-page.md | **Opens automatically on first workspace setup**; tracked-file count, thread count, language breakdown, **AI-generated codebase summary**, onboarding/feature banners |
| Augment Cosmos getting started | https://docs.augmentcode.com/cosmos/getting-started.md | Expert / Environment / Capability / Trigger / Session / Automation / Files; cloud sandboxes, VM or your laptop; web/mobile/Slack |
| Augment Memory | https://docs.augmentcode.com/cosmos/experts-memory.md | Cross-session memory in VFS; **simple memory** (explicit feedback) and **noisy memory** (evidence log → promote after strong signal); tells you when it remembers so you can veto |
| Augment Auggie interactive | https://docs.augmentcode.com/cli/interactive.md | Full-screen TUI; `/fork`, `/tree` (session branches), `/worktree`, `/effort`, `/enhance`, `/permissions`, `/hooks`, `/export` HTML/JSONL; Ctrl+P prompt enhancer; ACP, SDKs |

> **Honesty note / ملاحظة أمانة:** `websearch` returned HTTP 402 in this
> environment (same as the v11.34 round), so every fact above came from direct
> `webfetch` of the official page. `webfetch` on `kilo.ai/docs/overview` and
> `augmentcode.com/docs/overview` 404'd; the real roots are `kilo.ai/docs` and
> `docs.augmentcode.com`. Nothing below is inferred from marketing screenshots.
> لم أختلق ميزة؛ websearch أعاد 402، وكل الوقائع من webfetch مباشرة.

---

## 2. جدول الفجوات الصادق / Honest gap table

**Key:** **HAS** = real reachable SADEEM implementation · **PARTIAL** = present
but narrower · **WEAK** = code exists but users/models don't see it (salience) ·
**GAP** = genuinely absent · **N/A** = absent by local-first design.
`file:line` references are SADEEM source paths verified in this workspace.

| # | Capability | Kilo (official) | Augment (official) | SADEEM (`file:line`) | Verdict |
|---|---|---|---|---|---|
| 1 | Chat / natural-language task | "type in plain English, no special commands" (`chat-interface`) | Agent + Chat (`using-augment/agent.md`, `chat.md`) | `src/components/ChatPanel.tsx`, `src/components/Composer.tsx` | **HAS** |
| 2 | Specialized agents / modes | Code, Ask, Plan, Debug, custom; no built-in Review agent in IDE/CLI | Experts (PR Author, Deep Reviewer, Verifier, Project Builder…) | `electron/agent/prompts.ts:156-179` (mode specs, plan = hard `readOnly`), `electron/agent/tool-defs.ts:985` (`propose_plan`), `electron/agent/agents.ts` | **HAS** — ours are stricter on plan; weaker on discoverability |
| 3 | Read-only / approval modes | Auto-approve most, Allow/Ask/Deny per tool | Tool permissions honored by Auggie + Cosmos (not IDE ext.) | `prompts.ts:855` (4 modes), `.surnia/policy.json` gate | **HAS** |
| 4 | Bring-your-own-key / many models | **500+ models, zero markup, BYOK, local models**, Auto Model | Available models + token-based pricing | `src/store.ts` `PROVIDER_PRESETS`, `src/components/Onboarding.tsx:232-238` | **PARTIAL** — real multi-provider BYOK, but not 500 models and no gateway |
| 5 | IDE extensions (VS Code / JetBrains) | YES (VS Code, JetBrains, Cursor/Windsurf forks) | YES (VS Code, JetBrains, Vim/Neovim) | — standalone Electron app only | **GAP** — honest structural gap |
| 6 | Cloud / remote agents | Cloud agents, Cloud Agent platform, Slack, Mobile | Cosmos cloud sandboxes + self-hosted daemons | — local-first by design | **N/A** — product decision, not a prompt fix |
| 7 | Open source / inspectable prompt | **MIT**, prompt & context visibility, no silent model switching | Proprietary platform | Source present in this workspace; **no public MIT repo claim made here** | **GAP** — we cannot claim this |
| 8 | Session sharing / fork / multi-surface sync | read-only share links + fork; sessions sync IDE↔CLI↔cloud↔mobile | private/shared Sessions, web/mobile/Slack | `electron/preload.ts:237,239` — standalone `sessionExport` / `sessionExportHtml`, not a live link | **GAP** |
| 9 | Session history, resume, branching | session tabs, history search, `/export` | `/fork`, `/tree` session branches, `/import` | `src/store.ts` sessions + `journals/*.jsonl` + `traces/*.jsonl` (see `docs/CAPABILITIES-V1126.md:67-69`), `src/components/AgentTeamCard.tsx:188-219` (child-session drill-in) | **HAS** — child drill-in is a genuine, concrete UX asset; not unique (Auggie has `/tree`) |
| 10 | Codebase indexing / semantic context | codebase indexing, context condensing, `.kilocodeignore` | **Context Engine** + workspace indexing + Context Engine MCP/SDK | `electron/agent/lspLanguages.ts`, `dna.ts:811-988` (BM25-lite cross-session recall), `prompts.ts` search tools | **PARTIAL** — local LSP + lexical recall, no semantic index |
| 11 | MCP | STDIO/SSE, MCP overview | MCP Registry (Cosmos), CLI integrations | `prompts.ts:1021` (dynamic `mcp__<server>__<tool>`, opt-in), `prompts.ts` MCP section | **HAS** |
| 12 | Skills | Skills docs | agentskills.io skills (Cosmos + CLI) | `prompts.ts:1033,1038` (SKILLS-FIRST), `tool-defs.ts:1004,1017` | **HAS** |
| 13 | Hooks (lifecycle automation) | Workflows/customization; (Auggie hooks in Augment) | CLI hooks + hook examples | `electron/agent/hooks.ts:42-56` — only `PreToolUse`/`PostToolUse` | **PARTIAL** — genuine breadth gap (no SessionStart/Stop/PreCompact/agent hooks) |
| 14 | Checkpoints / rewind | Checkpoints doc | `/fork`, `/tree`, session tree | `tool-defs.ts:820` (`checkpoint_save`), `checkpoint_restore` | **HAS** |
| 15 | Subagents / workers | Custom subagents, orchestrator deprecated (native subagents) | Cosmos workers/subagents, CLI subagents | `electron/agent/agents.ts` (specialists), `task` tool, `prompts.ts` roster | **HAS** |
| 16 | Worktrees | parallel isolated worktrees, Agent Manager | `/worktree` (create/switch/delete) | `tool-defs.ts:752` (`worktree_create`), `electron/services/gitService.ts` | **HAS** |
| 17 | Code review | AI PR reviews, configurable styles + focus areas | Deep Reviewer/Pair Reviewer/PR Fixer/Risk Analyzer + Code Review Memory | `prompts.ts` review mode, `tool-defs.ts` `review_diff` | **PARTIAL** — review mode + tools exist; no dedicated multi-expert review pipeline |
| 18 | Scheduled tasks / event automation | GitHub Actions, scheduled scans, integrations | Cosmos Triggers: cron, webhook, GitHub/Slack/Linear/Jira/PagerDuty | `electron/services/flowsService.ts`, `electron/services/scheduleService.ts` (+ proof gate, `docs/FLOWS-SCHEDULE-TRUTH.md:111-129`) | **PARTIAL** — local cron + replay, no external event triggers |
| 19 | Browser / UI verification / media | Browser Use, Autocomplete, Git commit gen | Web Access capability, prompt enhancer | `prompts.ts:737` (finishing loop), `:841` (lighthouse/e2e/a11y), `:774` (image_generate) | **HAS** — broader verification set than advertised by either |
| 20 | Telemetry / trace export | not advertised | **OpenTelemetry Trace Export** (traces/metrics/logs) | local `traces/*.jsonl` only (`electron/agent/traces.ts`) | **GAP** — no external observability sink |
| 21 | Continuous user learning (memory/DNA) | "Memory" = project details across sessions | sophisticated Memory (simple/noisy evidence promotion) | `electron/agent/dna.ts:53-68` (bounded model), `:478` (confidence rule), `:611-734` (render into system prompt) | **HAS, NOT UNIQUE** — ours is local user-owned + confidence + honest prompt-visibility proof; Augment's is arguably more sophisticated |
| 22 | 145-tool roster exposed to the model | tool list exists but not a capability roster | Capability bundles per Expert | `prompts.ts:801-817` (intent-grouped CAPABILITY ROSTER), `electron/agent/signatureFeatures.ts:642,718` (routing graph + compass) | **WEAK** — code exists; a weak model still sees a huge registry. This is the v11.34 salience fix, not a missing tool |
| 23 | Per-model effort control | Auto Model routing (Efficient/Frontier/Free) | `/effort`, Shift+Tab cycle reasoning effort | `src/components/EffortControl.tsx:1-34`, `shared/effort.ts` | **HAS** |
| 24 | Three-ledger replay with per-step provenance | not advertised | not advertised | `signatureFeatures.ts:197-374`, `SignaturePanel.tsx:283-326` | **HAS (signature)** — genuinely ours in this exact form |
| 25 | Tool-coverage compass from real inventory | not advertised | not advertised | `signatureFeatures.ts:642-828`, `SignaturePanel.tsx:357-442` | **HAS (signature)** — genuinely ours in this exact form |
| 26 | DNA Autopsy (why learned / will model see it) | not advertised | memory view + "tells you when it remembers" | `signatureFeatures.ts:472-500,516-628`, `SignaturePanel.tsx:329-355` | **HAS but DUPLICATES our own DNA rail** — see `SIGNATURE-DECISION-V1140.md` |

**Count:** HAS = 15 · PARTIAL = 5 · WEAK = 1 · GAP = 4 · N/A = 1 (26 rows total).
**العد:** موجود ١٥ · جزئي ٥ · ضعيف البروز ١ · فجوة ٤ · لا ينطبق ١ (٢٦ صفًا).

> **Brutally honest conclusion:** 20 of 26 rows are present in SADEEM source (15 HAS + 5 PARTIAL).
> The four real gaps are structural (IDE extension, cloud, public MIT repo,
> share links/telemetry) and cannot be closed by a prompt. Everything marked
> PARTIAL/WEAK is a **visibility or breadth** problem. The founder's instinct
> "most features already exist" is correct; the missing piece is making them
> obvious on the **first screen**.
> **الخلاصة الصادقة:** ٢١ من ٢٦ صفحة موجودة في الكود. الفجوات الحقيقية
> بنيوية. الباقي مشكلة بروز/اتساع، لا ميزة ناقصة.

---

## 3. الشاشة الأولى / onboarding & first screen

### Kilo (from official docs)
- First task guide: click the icon → **type plain English → Enter**; most tools
  auto-approved; only shell / outside-dir / sensitive reads prompt
  (`getting-started/quickstart`). The documentation's own advice:
  "Just type what you want in normal English. No special commands needed"
  (`chat-interface`).
- Chat UI essentials: input box, approve/reject buttons, **agent dropdown**,
  session management, `@` file mentions, **suggested responses** when the agent
  asks a question (`chat-interface`).
- No account gate described in the first-task flow; BYOK or built-in provider
  is configured in Settings (`getting-started`, `byok`).

### Augment (from official docs)
- **"The Home Page opens automatically when you first set up a workspace"**
  and shows tracked-file count, thread count, language breakdown, an
  **AI-generated codebase summary**, plus onboarding/feature banners
  (`using-augment/home-page.md`). That is a deliberate "show value first"
  opening screen.
- Cosmos: you drive cloud Experts from web/phone/Slack; Advisor can wire
  things up conversationally (`cosmos/getting-started.md`,
  `cosmos/advisor/overview.md`).

### SADEEM (verified source)
Actual first-run chain:
1. spinner while `!booted` — `src/App.tsx:346-352`;
2. **full-screen account gate** — `App.tsx:354-361` + `AuthGate` `:406-435`;
3. **one skippable onboarding screen** with provider + API key + security
   posture — `App.tsx:386`, `src/components/Onboarding.tsx:30,106-394`;
4. **WorkspaceGate → Welcome hero** — `App.tsx:392,397-401`,
   `src/components/Welcome.tsx:73,172-416`;
5. only then the workspace/chat.

**Honest assessment:** SADEEM's Welcome is not ugly — it already has a
premium hero (logo plate, wordmark, version stamp, display heading), three
starter cards, model/security panels, recent projects, and bilingual RTL-safe
tokens (`Welcome.tsx:178-416`). The problem is **ordering and messaging**: we
ask for account → key → security posture → folder before the user sees any
proof. Kilo asks for nothing before the first prompt; Augment shows an
AI-generated summary of *their code* first. Our differentiator (145 tools,
DNA proof, plan/verify loop) is buried in a single line at
`Onboarding.tsx:157-177` and a palette-hidden capability guide
(`App.tsx:34,391`).

**Recommendation (parent implements; this wave did not touch source):**
- Make the first opened screen a **value-first stage**: the Welcome hero with
  a live, read-only preview of what SADEEM already knows (recent projects +
  a "what SADEEM can do" proof strip driven by the real capability roster),
  and defer account/key/security to a dismissible panel after the first action.
- Borrow the *pattern*, not the pixels: Kilo's "one input box, plain language"
  and Augment's "auto-generated project summary on open". Do **not** copy their
  branding or claim their capabilities.
- Re-skin the Signature rail title if the remaining two instruments are kept:
  "Signature" is vague; "Run Intelligence / استخبارات التشغيل" says what it is.

---

## 4. Limits / حدود

- Public docs describe the **advertised** surface; internal prompts and exact
  UI pixels were not requested and are not claimed.
- "Not advertised" in the table means **not found in the official pages
  fetched**, not proof of total absence in the product.
- No feature was invented; where SADEEM is weaker, the doc says so plainly.
- The founder's phrase " confidentiality/خصوصية" was not part of this brief;
  local-first is stated as a design fact, not a marketing superiority claim.
