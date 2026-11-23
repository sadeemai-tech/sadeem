# SADEEM Docs Writing Style — v11.44

**Goal:** make the SADEEM website read like professional developer documentation, not marketing copy.
**الهدف:** أن تبدو صفحات سادم كوثائق تقنية احترافية، لا كنصوص تسويقية.

This is a **research-only** document. Every quoted line below was fetched from the real official docs homepage or install page of a competitor on **2026-11-22**. No feature, number, or command is invented. Citations use the exact URL fetched.

هذا مستند بحث فقط. كل سطر مقتبس أدناه جُلب من الصفحة الرسمية الحقيقية (الرئيسية أو صفحة التثبيت) لأحد المنافسين بتاريخ ٢٠٢٦-١١-٢٢. لا توجد ادعاءات أو أرقام أو أوامر مُختلقة. الاقتباسات مرفقة بالرابط الحقيقي.

---

## Sources fetched / المصادر التي تم جلبها

| Product | Page fetched | URL |
| --- | --- | --- |
| Claude Code | Overview + Quickstart | `https://docs.claude.com/en/docs/claude-code/overview` · `https://docs.claude.com/en/docs/claude-code/quickstart` |
| OpenCode | Docs intro (install tabs) | `https://opencode.ai/docs` |
| Kilo Code | Docs home + Installation | `https://kilo.ai/docs` · `https://kilo.ai/docs/getting-started/installing` |
| Cursor | Docs home + Quickstart/Installation | `https://cursor.com/docs` · `https://cursor.com/docs/get-started/installation` |
| Zed | Getting Started + Linux install | `https://zed.dev/docs` · `https://zed.dev/docs/linux` |

---

## 1. Ten style rules, derived from real examples / عشر قواعد أسلوبية مستمدة من أمثلة حقيقية

### Rule 1 — Open with one literal sentence that says what the tool *is*, not what it *believes in*
**القاعدة ١ — ابدأ بجملة حرفية واحدة تقول ما الأداة، لا ما تؤمن به**

The lead is a definition plus a verb list. No adjectives.

> "Claude Code is an agentic coding tool that reads your codebase, edits files, runs commands, and integrates with your development tools." — [Claude Code overview](https://docs.claude.com/en/docs/claude-code/overview)

> "OpenCode is an open source coding agent. It's available as a terminal-based interface, desktop app, or web app." — [OpenCode docs](https://opencode.ai/docs)

> "Zed is an open-source code editor with built-in collaboration and AI tools." — [Zed Getting Started](https://zed.dev/docs)

> "Cursor is a coding agent for building ambitious software. Use it to understand your codebase, plan and build features, fix bugs, review changes, and work with the tools you already use." — [Cursor docs](https://cursor.com/docs)

**SADEEM action:** replace "The coding agent that learns with you" with a definition: what it is + what it does + where it runs. Keep "local-first" only as a concrete claim (keys stay on the machine), not as a vibe.

---

### Rule 2 — Short verb-first sentences; each sentence does one thing
**القاعدة ٢ — جمل قصيرة تبدأ بفعل؛ كل جملة تؤدي وظيفة واحدة**

> "Read, edit, run, browse, preview and debug — every capability is a clearly described tool..." — [Claude Code overview](https://docs.claude.com/en/docs/claude-code/overview)

> "Download Cursor. Open the app and sign in. Then pick a folder and start with a small task." — [Cursor Quickstart](https://cursor.com/docs/get-started/installation)

> "Open a folder from the command line:" / "Or use `Cmd+O` ... to open a folder from within Zed." — [Zed Getting Started](https://zed.dev/docs)

**SADEEM action:** break compound marketing sentences into imperative steps: "Install." "Open a folder." "Describe the task." "Review the diff." Avoid stacking 3 benefits in one sentence.

---

### Rule 3 — Show a concrete benefit, not a hype adjective
**القاعدة ٣ — اعرض فائدة ملموسة بدل نعت مبالغ فيه**

> "Homebrew offers two casks. `claude-code` tracks the stable release channel, which is typically about a week behind and skips releases with major regressions." — [Claude Code overview](https://docs.claude.com/en/docs/claude-code/overview)

> "The apt and yum packages are preferred over AppImage. They provide desktop icons, automatic updates, and CLI tools." — [Cursor Quickstart](https://cursor.com/docs/get-started/installation)

> "The npm package uses a postinstall script to select the native `opencode` binary for your platform." — [OpenCode docs](https://opencode.ai/docs)

**SADEEM action:** instead of "sharper every run", state the mechanism: what is stored, what is read back, what changes. Instead of "private by architecture", state: credentials and files stay on your machine; dangerous commands wait for approval.

---

### Rule 4 — Prove every capability with a copyable command or code block
**القاعدة ٤ — أثبت كل قدرة بأمر أو كتلة كود قابلة للنسخ**

> ```bash
> tail -200 app.log | claude -p "Slack me if you see any anomalies"
> ```
> — [Claude Code overview, "Pipe, script, and automate with the CLI"](https://docs.claude.com/en/docs/claude-code/overview)

> ```bash
> $ opencode pair
>   Open a link to connect. Links work once and expire in 5 minutes.
> ```
> — [OpenCode docs, "Web"](https://opencode.ai/docs)

> ```sh
> zed ~/projects/my-app
> ```
> — [Zed Getting Started, "1. Open a Project"](https://zed.dev/docs)

**SADEEM action:** every feature card on `/features` needs a terminal block or a real UI path (e.g. the exact menu/command), not just a paragraph. If no command exists, show the concrete click path.

---

### Rule 5 — Second person + imperative, terse
**القاعدة ٥ — مخاطبة المتحدث بـ"أنت" وأوامر موجزة**

> "Replace `/path/to/your/project` with the path to the project you want to work on." — [Claude Code Quickstart](https://docs.claude.com/en/docs/claude-code/quickstart)

> "To confirm the installation worked, run:" / "To install Claude Code, open a terminal and run the command for your system." — [Claude Code Quickstart](https://docs.claude.com/en/docs/claude-code/quickstart)

> "Make OpenCode your own by editing the [OpenCode config](/config), [loading plugins](/plugins), [connecting MCP servers](/mcp-servers), or [creating commands](/commands)." — [OpenCode docs, "Customize"](https://opencode.ai/docs)

**SADEEM action:** use "run", "open", "replace", "choose", "review". No "we believe", "we're excited", "our mission". Arabic: استخدم أوامر مباشرة (شغّل، افتح، استبدل، راجع) بخطاب موجه للقارئ.

---

### Rule 6 — Numbered steps with outcome-verification after each install
**القاعدة ٦ — خطوات مرقّمة مع تحقق من النتيجة بعد التثبيت مباشرة**

The Claude Code quickstart is literally `Step 1 … Step 7`, and verification is a single command:

> "The command prints a version number followed by `(Claude Code)`." — [Claude Code Quickstart, Step 1](https://docs.claude.com/en/docs/claude-code/quickstart)

> "To confirm the installation worked, run: `claude --version`" — [Claude Code Quickstart](https://docs.claude.com/en/docs/claude-code/quickstart)

Zed uses the same numbered pattern: `1. Open a Project` → `2. Learn the Essential Commands` → `3. Configure Your Editor` → `4. Set Up Your Language` → `5. Try AI Features`. — [Zed Getting Started](https://zed.dev/docs)

Kilo uses a numbered list too: "1. Open VS Code / 2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`) / 3. Search for 'Kilo Code' / 4. Click the dropdown arrow next to Install…" — [Kilo Installation](https://kilo.ai/docs/getting-started/installing)

**SADEEM action:** `/download` and `/docs` quickstart must end each install path with a verify step and a "Next" link, not with a CTA banner.

---

### Rule 7 — Structure pages quickstart → concepts → features → reference
**القاعدة ٧ — ترتيب الصفحات: بدء سريع ← مفاهيم ← ميزات ← مرجع**

Real structures observed:

- **Claude Code overview:** `Get started` → `What you can do` → `Use Claude Code everywhere` → `Next steps`. The "Next steps" items are labeled by outcome: "Quickstart: walk through your first real task, from exploring a codebase to committing a fix" — [Claude Code overview](https://docs.claude.com/en/docs/claude-code/overview)
- **Cursor docs:** `Start here` → `What you can do with Cursor` → `Models` → `More resources` → `Sitemap` — [Cursor docs](https://cursor.com/docs)
- **Kilo docs:** top nav `Get Started / Code with AI / Customize / Collaborate / Automate / Deploy & Secure / Kilo Gateway / Kilo Desktop` — [Kilo docs](https://kilo.ai/docs)
- **OpenCode docs:** `CLI → Connect → Customize → Learn` — [OpenCode docs](https://opencode.ai/docs)
- **Zed docs:** `Quick Start → Coming from Another Editor? → Join the Community` — [Zed Getting Started](https://zed.dev/docs)

**SADEEM action:** `/docs` is the hub with 4 tracks (Get started / Use / Customize / Reference). Do not mix pricing or hero copy into it.

---

### Rule 8 — Name the exact UI location, shortcut, or flag; never say "intuitive"
**القاعدة ٨ — اذكر الموقع الدقيق أو الاختصار أو العلم؛ لا تقل "بديهي"**

> "Or use `Cmd+O` (macOS) / `Ctrl+O` (Linux/Windows) to open a folder from within Zed." — [Zed Getting Started](https://zed.dev/docs)

> "Press Shift+Tab in the agent input to toggle **Plan Mode**. Instead of writing code right away, Cursor will: 1. Research your codebase… 2. Ask clarifying questions… 3. Create a detailed implementation plan… 4. Wait for your approval before building" — [Cursor Quickstart](https://cursor.com/docs/get-started/installation)

> "The command palette (`Cmd+Shift+P`) is your gateway to every action in Zed. If you forget a shortcut, search for it there." — [Zed Getting Started](https://zed.dev/docs)

**SADEEM action:** say "press `Ctrl+K`", "open Settings → MCP", "run `/review-pr`". Delete any sentence whose only content is "easy", "intuitive", "seamless", "powerful".

---

### Rule 9 — Use "what I want to do → best option" tables and explicit limits/troubleshooting
**القاعدة ٩ — استخدم جداول "ما الذي أريده ← الخيار الأفضل" وحدوداً واستكشاف أخطاء صريحاً**

> Table header: "What I want to do | Best option" — [Claude Code overview](https://docs.claude.com/en/docs/claude-code/overview)

> "Windows package managers are not supported." — [OpenCode docs](https://opencode.ai/docs)

> "You will need to build from source for: architectures other than 64-bit Intel or 64-bit ARM… Redhat Enterprise Linux 8.x…" — [Zed Linux](https://zed.dev/docs/linux)

> "If you see `The token '&&' is not a valid statement separator`, you're in PowerShell, not CMD." — [Claude Code Quickstart](https://docs.claude.com/en/docs/claude-code/quickstart)

> Troubleshooting bullets: "**Extension Not Visible** – Restart VS Code – Verify Kilo Code is listed and enabled…" — [Kilo Installation](https://kilo.ai/docs/getting-started/installing)

**SADEEM action:** state platform limits flatly (Windows-native installer; no claim about a macOS build unless it exists). Match known error strings to fixes. This builds more trust than any adjective.

---

### Rule 10 — If you give an example, give the *bad* version and the *good* version
**القاعدة ١٠ — عند ذكر مثال، اعرض النسخة السيئة والنسخة الجيدة**

> "Be specific with your requests — Instead of: 'fix the bug' — Try: 'fix the login bug where users see a blank screen after entering wrong credentials'" — [Claude Code Quickstart, "Pro tips for beginners"](https://docs.claude.com/en/docs/claude-code/quickstart)

> "Good first tasks are low risk, like improving some copywriting or fixing small UI issues." — [Cursor Quickstart](https://cursor.com/docs/get-started/installation)

**SADEEM action:** document prompting and configuration by contrast ("Instead of… Try…"). This is developer documentation's native teaching pattern.

---

## 2. Before / After — one real SADEEM sentence / مثال قبل وبعد من موقع سادم الفعلي

**Source of the "before":** the live homepage hero in `website/components/home/HomeContent.tsx`, line ~212–214:

> **BEFORE (current):** "The coding agent that learns with you."
> (Arabic current: "وكيل البرمجة الذي يتعلّم معك.")
> Related lead, same file: "SADEEM gets sharper every run — and your keys never leave your machine."

Why it fails against the rules: "learns with you" and "gets sharper" are unverifiable adjectives. No verb list, no mechanism, no number, no command. It could describe any product.

**AFTER (developer-docs style — uses only facts already in that same file):**

> **EN:** "SADEEM is a local-first coding agent for Windows. It reads and edits files, runs commands, and calls 145 tools. It ships with 12 specialist subagents and a playbook it updates as you work. Credentials and files stay on your machine."
>
> **AR:** "سادم وكيل برمجة محلي يعمل على ويندوز. يقرأ الملفات ويعدّلها ويشغّل الأوامر ويستدعي ١٤٥ أداة. يضم ١٢ وكيلاً متخصصاً ودليلاً حيّاً يحدّثه أثناء العمل. تبقى بيانات الاعتماد والملفات على جهازك."

Then a copyable next step, exactly like Claude Code Quickstart Step 2:

```text
# open a project folder, then describe a task
sadeem <path-to-project>
"Find the entry point and explain the folder structure"
```

> ⚠️ Verification note: the exact CLI command above must match what SADEEM actually ships. The current `website/app/download/page.tsx` exposes only a Windows installer and contains no CLI install command — do not publish a command that does not exist. The **structure** (install → verify → first task) is what is being borrowed from competitors.

---

## 3. Recommended page structure / البنية المقترحة للصفحات

### `/features` — capabilities, each with proof / القدرات، ولكل منها دليل

Model: Claude Code "What you can do" accordions + Cursor "What you can do with Cursor" cards — [Claude Code overview](https://docs.claude.com/en/docs/claude-code/overview) · [Cursor docs](https://cursor.com/docs).

1. **One-line definition** (Rule 1). No hero, no animated badge.
2. **Capability cards**, each containing exactly:
   - concrete title (e.g. "Isolated worktrees", "MCP catalog, install-ready" — both already in `HomeContent.tsx`),
   - one verb-first sentence,
   - a copyable command or exact UI path,
   - a link to the relevant `/docs` page.
3. **"What I want to do → where to go" table** (Rule 9), like Claude Code's "Use Claude Code everywhere" table.
4. **Limits block** at the bottom (platforms, no macOS claim unless real).
5. No pricing, no testimonials, no "why choose us".

### `/docs` — the documentation hub / مركز الوثائق

Model: Kilo/BookStack-shaped nav + Claude Code "Next steps" labels — [Kilo docs](https://kilo.ai/docs) · [Claude Code overview](https://docs.claude.com/en/docs/claude-code/overview).

```
/docs
├── Get started
│   ├── Installation            (per-platform tabs + verify command)
│   ├── Quickstart              (install → sign in → first change → review diff)
│   └── Authentication / BYOK
├── Use SADEEM
│   ├── The chat interface
│   ├── Tools & approval rules
│   ├── Subagents
│   ├── Worktrees & parallel sessions
│   ├── Schedules & proof gates
│   └── MCP servers
├── Customize
│   ├── Playbook / instructions
│   ├── Skills & plugins
│   ├── Providers (12)
│   └── Settings & keybindings
└── Reference
    ├── CLI commands
    ├── Slash commands
    ├── Configuration keys
    ├── Troubleshooting
    └── FAQ
```

Rules for the hub: every item name is a noun or verb phrase ("Authentication", "Run your first task"), never a slogan. Each page ends with a `Next` link, as Kilo does ("After installation: 1. Set up authentication… 2. Run your first task…" — [Kilo Installation](https://kilo.ai/docs/getting-started/installing)).

### `/download` — install commands first, above the fold / أوامر التثبيت أولاً

Model: OpenCode's tabbed install block + Claude Code's per-shell commands + Zed's `curl | sh` — [OpenCode docs](https://opencode.ai/docs) · [Claude Code overview](https://docs.claude.com/en/docs/claude-code/overview) · [Zed Linux](https://zed.dev/docs/linux).

Real competitor patterns to copy **structurally**:

- **Tabs by install method, code-first.** OpenCode shows: `curl -fsSL https://opencode.ai/v2/install | bash`, `brew install anomalyco/tap/opencode-v2`, `npm install -g @opencode/cli`, `bun install -g --trust @opencode/cli`, `pnpm add -g --allow-build=@opencode/cli @opencode/cli`, `yarn global add @opencode/cli`, `mise use -g opencode` — [OpenCode docs](https://opencode.ai/docs).
- **One `curl | sh` line plus a preview channel.** `curl -f https://zed.dev/install.sh | sh` and `curl -f https://zed.dev/install.sh | ZED_CHANNEL=preview sh` — [Zed Linux](https://zed.dev/docs/linux).
- **Per-shell commands on Windows.** `irm https://claude.ai/install.ps1 | iex` (PowerShell) and `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` (CMD) — [Claude Code overview](https://docs.claude.com/en/docs/claude-code/overview).
- **Package managers as a secondary list.** `brew install --cask claude-code`, `winget install Anthropic.ClaudeCode`, plus "You can also install with apt, dnf, or apk…" — [Claude Code overview](https://docs.claude.com/en/docs/claude-code/overview).
- **Standalone binaries table by OS/arch.** Zed/OpenCode list direct `.zip` / `.tar.gz` / `.dmg` / `.exe` links grouped by OS and architecture — [OpenCode docs](https://opencode.ai/docs) · [Zed Linux](https://zed.dev/docs/linux).

Recommended SADEEM `/download` order:

1. `Install` — tab block: **Windows (native installer)** first, then **CLI** tab with `curl`/`npm` **only if those commands exist**, then package managers if they exist. Show the code block before any prose.
2. `Verify` — `sadeem --version` (or the real equivalent) + "prints a version number". Model: Claude Code Quickstart.
3. `Standalone binaries` — table by OS + architecture, only for artifacts that are actually published.
4. `First task` — link to `/docs/get-started/quickstart`.
5. `Troubleshoot` — exact error string → fix; explicit unsupported platforms.
6. `Uninstall` — Zed documents `zed --uninstall`; document the real SADEEM uninstall path.

**Placement rule:** the install command must be the first non-navigation content on `/download` and in the `/docs` "Get started" page. Competitors put it above all benefits — OpenCode's very first section after its one-line definition is the install CodeTabs; Zed's Linux page opens with the script before listing requirements.

---

## Quick checklist / قائمة تحقق سريعة

- [ ] Definition sentence, verb list, zero hype adjectives (Rule 1)
- [ ] Sentences ≤ ~20 words, one job each (Rule 2)
- [ ] Every "benefit" is a mechanism or a number already in the code (Rule 3)
- [ ] Every feature has a command or exact click path (Rule 4)
- [ ] Second person + imperative; no "we believe / excited / mission" (Rule 5)
- [ ] Numbered steps, verify command after install (Rule 6)
- [ ] quickstart → concepts → features → reference (Rule 7)
- [ ] Shortcuts, flags, menu paths named explicitly (Rule 8)
- [ ] Limits + error→fix table on every install page (Rule 9)
- [ ] "Instead of / Try" teaching examples (Rule 10)
- [ ] No invented command, no invented platform, no invented number
