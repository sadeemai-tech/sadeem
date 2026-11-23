# Competitor Research & SADEEM Design Brief

Prepared for the SADEEM marketing website (v11.12.0). Research date: 2026-11-18.

## Method & honesty note

- All 10 official sites were fetched live via `webfetch` (HTML/markdown) and read in full. Every site below is grounded in that fetched text plus the brands' well-documented public visual identities.
- **Screenshots did NOT work.** An attempt was made with the in-app browser (`tools.browser.tabs.open` → `wait` → `tabs.focus` → `screenshot`). It failed before any tab opened with:
  > `[browser.disconnected] No desktop browser is connected to this session. Open this session in the desktop app and wait for it to connect.`
  The environment also has a known prior failure mode ("Screenshot needs a visible tab / keep its desktop window visible"). Per instructions, the attempt was not retried. No screenshot artifacts exist. All visual analysis below is therefore text-derived, not pixel-verified — treat color/type/spacing specifics as informed description, not measured values.
- Two market-consolidation facts surfaced during research and are worth noting: **Windsurf is now Devin Desktop** (windsurf.com redirects to devin.ai), and **Continue has joined Cursor** (continue.dev is a "thank you" notice). Both are reflected below.

---

## 1. OpenCode — https://opencode.ai

- **Visual system:** Monochrome, developer-tool aesthetic. Near-black/off-white canvas, a single electric-green accent, heavy use of monospace display type for headings and code. Dense but disciplined spacing; the hero is the product itself (terminal/desktop UI) rather than an illustration. Install commands are presented as first-class design elements, not footnotes. Motion is minimal — confident, static, "no fluff."
- **Strongest ideas to adapt:**
  1. *Terminal-as-hero* — show the real UI/command, don't decorate around it. Credibility beats illustration for this audience.
  2. *Install command as a design motif* — one-line copy-paste CTA (`npm i -g …`) placed prominently, styled as a code block.
  3. *Radical specificity in social proof* — "Trusted by 22M+ developers including at NVIDIA, Cloudflare, Microsoft…" and huge raw numbers (220K stars, 1K+ contributors) instead of vague adjectives.
- **Marketing-copy angle:** "The open source coding agent — any model, any device, no lock-in." Copy is terse and factual; fluff is explicitly rejected. Free models first, bring your own subscription.
- **Takeaway for SADEEM:** Copy the restraint and the "show the product" hero. SADEEM can beat it on *local-first + Arabic* — neither of which OpenCode claims as a headline.

## 2. NousResearch Hermes — https://hermes-agent.nousresearch.com

- **Visual system:** Playful-but-technical. Warm cream/dark contrast, a distinctive wing/mascot illustration, numbered feature blocks (`#1 Connect`, `#2 Remember`…), and soft product mockups. Generous whitespace, rounded cards, editorial pacing. Motion implied via reveal-on-scroll and friendly illustrations.
- **Strongest ideas to adapt:**
  1. *Numbered feature narrative* — "#1 Lives Everywhere, #2 Persistent Memory, #3 Focused Automation…" turns a feature list into a story with momentum.
  2. *The "grows with you" emotional frame* — headline "The Agent That Grows With You" sells a relationship, not a spec sheet. Maps directly onto SADEEM's Living Playbook.
  3. *Persistent-memory / learned-skills angle* — "It learns your projects, auto-generates skills, and never forgets how it solved a problem." This is the same territory as SADEEM's Living Playbook; SADEEM must claim it more concretely.
- **Marketing-copy angle:** "One agent, one memory, every surface." Freedom/ownership framing ("The Internet's Own AI", MIT licensed) plus transparent pricing tiers.
- **Takeaway for SADEEM:** Adopt the numbered feature story and the relationship framing. Avoid the mascot/illustration whimsy — SADEEM reads more credible as a serious tool.

## 3. Anthropic — Claude Code — https://anthropic.com/claude-code

- **Visual system:** Premium, editorial, restrained. Anthropic's warm "book cloth" cream (#F0EEE6-ish) with terracotta/coral accent and near-black serif display headings paired with clean sans body. Large canvas, thin rules, lots of breathing room. Interactive product demos over subtle solid brand backgrounds. Logos of famous customers shown as a quiet trust band. Motion is subtle and expensive-feeling.
- **Strongest ideas to adapt:**
  1. *Interactive product demo embedded in the hero* — a real session with reasoning, tool rows, and diffs that a sighted user can play with, wrapped in a one-line caption for accessibility.
  2. *"Meets you where you code" surface grid* — Terminal / IDE / Web / Slack each with an image, reinforcing ubiquity without a feature dump.
  3. *Outcome-led headlines* — "Hand Claude a bug fix, test, or multi-day migration. You set its permissions." Concrete task nouns, not abstractions.
- **Marketing-copy angle:** Authority + control. "You're the architect; it does the work." Safety/permissions is a feature, repeated (permission modes, allow/deny rules, hooks, red-team claims).
- **Takeaway for SADEEM:** Borrow the editorial serif/cream sophistication and the "you set the permissions" control language — SADEEM's Tool Profiles and proof-gated schedules are a *stronger* concrete control story than Claude's generic permission modes.

## 4. OpenAI — Codex — https://openai.com/codex/

- **Visual system:** Soft, airy, product-first. White canvas with pastel gradient panels behind UI screenshots. Large friendly sans headline ("Build anything with Codex"), short sub-line, then full-width product cards each with a gradient background and an honest screenshot. Rounded cards, generous padding, polished depth. Motion: gentle reveal, parallax-lite gradients.
- **Strongest ideas to adapt:**
  1. *One headline + one promise, then screenshots* — "Build anything with Codex / Move faster, go further, and bring your biggest ideas to life." No jargon in the first fold.
  2. *Feature = screenshot + one-sentence caption* (e.g. "Designed for multi-agent workflows" with a parallel-agents image). Extremely scannable.
  3. *Parallel agents and "keeps going in the cloud"* — the multi-agent/workflow story is front and center. SADEEM has 12 subagents + git worktrees; it should show the same "fleet working in parallel" visual.
- **Marketing-copy angle:** Empowerment and scale — "The best way to build with agents," "trusted by top teams," named customer outcomes with hard numbers (30–50% faster, ship in a weekend).
- **Takeaway for SADEEM:** Adopt the clean pillar-card rhythm, but swap cloud for local — "keeps going *on your machine*" is a differentiator OpenAI cannot say.

## 5. Cursor — https://cursor.com

- **Visual system:** Sleek, dark-forward, high-contrast. Deep charcoal/black with a sharp red-coral brand accent, large geometric sans, and immersive full-bleed UI demos over artistic wallpapers. Tight, confident spacing. "Interactive demo for sighted users" patterns with a landscape/painted backdrop give an artistic, premium feel. Motion is fluid and cinematic.
- **Strongest ideas to adapt:**
  1. *Big, declarative single-line positioning* — "Cursor is your coding agent for building ambitious software." One sentence, memorable.
  2. *Testimonial wall with heavyweight names* — Diana Hu, Jensen Huang, Karpathy, Patrick Collison, one punchy quote each. Social proof as a design section, not a footer.
  3. *"In every tool, at every step" surface story* + a giant `curl … | bash` install line.
- **Marketing-copy angle:** Ambition + autonomy + status. "Stay on the frontier," "hand work to AI teammates," Fortune 500 trust. Copy leans into prestige.
- **Takeaway for SADEEM:** Adopt the confident one-line positioning and a compact quote wall. Avoid the "connected to SpaceX / frontier elite" status-posturing — SADEEM's angle is independence, not membership in a club.

## 6. v0 — https://v0.app

- **Visual system:** Minimal, black-and-white Vercel lineage. Very sparse layout, monospaced labels, strong typographic hierarchy, black background sections alternating with white. Cards are simple bordered panels; the emphasis is on what you can *make*, shown via example galleries. Motion is crisp and quick.
- **Strongest ideas to adapt:**
  1. *Role-based "who is this for?" matrix* — PM, Designer, Engineer, Data Scientist, Marketing, Founder… each with 3 concrete example prompts. Answers "is this for me?" without a feature lecture.
  2. *"Describe your idea in your preferred language"* — v0 explicitly welcomes non-English input. SADEEM is Arabic-first; this is a direct, proven framing to localize and own.
  3. *Prompt-as-showcase* — real example prompts double as feature proof and onboarding education.
- **Marketing-copy angle:** Speed and accessibility of creation — "Ship features, refine designs, update copy, create live prototypes, all with a prompt." One-click deploy ("powered by Vercel").
- **Takeaway for SADEEM:** Adopt the role matrix and multilingual-input claim; make "Arabic-first" a first-class headline, not a locale toggle in the footer.

## 7. Windsurf / Devin Desktop — https://windsurf.com → devin.ai

- **Visual system:** Command-center aesthetic. Dark IDE-like canvas, a Kanban board (Running / Waiting for review / Done) with subagent tasks and PR links as the hero. Soft photographic/graphic backgrounds (`bg-1`…`bg-6.jpg`) behind UI panels. Dense but organized; green/amber status chips. Motion suggests live activity (agents working, PRs landing).
- **Strongest ideas to adapt:**
  1. *The "agent command center" Kanban hero* — visualize 8 subagents, 16 PRs, statuses. SADEEM's 12 subagents map perfectly; show them as a board, not a bullet list.
  2. *"One command center for every agent and model"* — an ACP/aggregation story. SADEEM's 12 providers can be framed as "every model, one local workspace."
  3. *"Local ↔ cloud handoff" / "your environment, everywhere"* — SADEEM should invert this to *local-only by design* as a trust statement.
- **Marketing-copy angle:** Orchestration and control — "Stop deprioritizing. Do it all with Devin." Move from single task to multi-agent projects; "you decide what to build, agents do the rest."
- **Takeaway for SADEEM:** Adopt the multi-agent board visualization and "command center" language. Avoid the cloud dependence — for SADEEM, local-first *is* the pitch.

## 8. GitHub Copilot — https://github.com/features/copilot

- **Visual system:** GitHub's clean, familiar system — white/light canvas, GitHub dark nav, blue accent, Inter-ish sans, card grids, and many annotated product screenshots. Structured, documentation-like, reassuring rather than flashy. Trust band of integration logos (VS Code, JetBrains, Slack, CLI…).
- **Strongest ideas to adapt:**
  1. *"More ways to get started" integration icon grid* — a wall of surfaces (VS Code, JetBrains, CLI, Slack, Neovim…) communicates reach instantly.
  2. *"Use the right model for each task"* with model-provider logos — SADEEM's 12 providers deserve exactly this kind of logo band (the downloaded `logos/` set is built for it).
  3. *Task-to-merge workflow framing* — "Start from an issue → run tasks in parallel → review → merge." A lifecycle, not a feature list.
- **Marketing-copy angle:** Practical and enterprise-safe — "Move from a single task to a project spanning repositories without losing context." Free tier, clear plan cards, FAQ-heavy.
- **Takeaway for SADEEM:** Adopt the provider-logo band and the lifecycle section. Copy the "no context lost" promise but ground it in the Living Playbook.

## 9. Aider — https://aider.chat

- **Visual system:** Deliberately plain, almost retro-web. White background, monospace-forward headings ("AI pair programming in your terminal"), minimal decoration, dotted divider lines, inline stats as badges (⭐ GitHub Stars 44K, 📦 Installs 6.8M, 📈 Tokens/week 15B, 🔄 Singularity 88%). A demo video sits in the hero. Extremely lightweight, fast, no-nonsense.
- **Strongest ideas to adapt:**
  1. *Raw stats as a trust strip* — "44K stars · 6.8M installs · 15B tokens/week · 88% of new code written by Aider." Numbers with personality. SADEEM has real numbers (142 tools, 12 providers, 12 subagents, 20+ MCP) to use the same way.
  2. *"Singularity 88%"-style audacious metric* — a single surprising number is more memorable than adjectives. SADEEM's "142 tools" can be that number.
  3. *Plain terminal honesty* — the anti-design *is* the brand. Doesn't require a big art budget; credibility comes from clarity.
- **Marketing-copy angle:** Understated competence — "pair program with LLMs to start a new project or build on your existing codebase." Feature grid is pure utility (cloud/local LLMs, repo maps, 100+ languages, git integration, lint/test).
- **Takeaway for SADEEM:** Adopt the stats strip and the unapologetic utility. SADEEM should be polished, but never sacrifice the "real tool for real devs" plainspokenness.

## 10. Continue — https://continue.dev (now part of Cursor)

- **Visual system:** The live site is now a minimal "thank you" page — small logo, a short acquisition notice ("Continue has joined Cursor"), a few FAQs, and one hero image. Historically Continue's brand was open-source, community-green, documentation-heavy. Current state is intentionally sparse.
- **Strongest ideas to adapt:**
  1. *A short, honest changelog-style notice* — useful precedent for how to communicate product transitions plainly (relevant if SADEEM ever ships major rebrands).
  2. *"Amplified, not automated"* — the line they chose as their legacy: "developers are amplified, not automated." Strong values-based copy; worth echoing in SADEEM's-human-in-control messaging.
  3. *Open-source codebase as a lasting artifact* — "our open-source codebase remains freely available as a foundation." Community trust through permanence.
- **Marketing-copy angle:** Legacy/gratitude rather than product pitch. Mission statement over features.
- **Takeaway for SADEEM:** Little to copy visually. Take the "amplified, not automated" value line and the lesson that ownership/openness is a durable trust signal.

---

## SADEEM Design Brief

### Positioning in one line
The local-first, Arabic-first coding agent for Windows that learns your workspace — 142 tools, 12 providers, and a fleet of subagents, all on your machine.

### Patterns to ADOPT
1. **Product-as-hero (OpenCode, Claude Code).** Lead with a real SADEEM session UI — terminal + diff rows + tool calls + a worktree/subagent panel — not an abstract illustration. Caption it for accessibility.
2. **One declarative headline + one promise (Cursor, Codex).** A single confident line in the first fold, in both Arabic and English.
3. **Numbered feature story (Hermes).** Turn the differentiators into a paced `#01 … #06` narrative so the page has momentum.
4. **Stats strip (Aider, OpenCode).** Raw numbers as social proof: `142 tools · 12 providers · 12 subagents · 20+ MCP servers`. No adjectives needed.
5. **Provider-logo band (GitHub Copilot).** Use the downloaded `public/media/logos/*.svg` (OpenAI, Anthropic, Google, Groq, Mistral, DeepSeek, Ollama, OpenRouter, Vercel, Supabase, …) to make "12 providers, bring your own keys" tangible.
6. **Multi-agent Kanban visual (Devin/Windsurf).** Show 12 subagents on isolated git worktrees as a live board with status chips — SADEEM's strongest visual differentiator.
7. **"You set the rules" control language (Claude Code).** Tool Profiles (essential/balanced/full) and proof-gated schedules are a concrete, honest control story — lead with it.
8. **Multilingual-input, role-based examples (v0).** A "who is this for?" matrix with real example prompts, including Arabic prompts.
9. **Quiet editorial sophistication (Anthropic).** Warm off-white/dark canvas, one accent color, strong type hierarchy, generous whitespace, thin rules.
10. **Abstract tech imagery, used sparingly (Codex).** The downloaded Unsplash images belong behind UI panels or as section backdrops — never as the hero itself.

### Patterns to AVOID
- **Cloud-first framing** ("runs in the cloud", "close your laptop") — SADEEM's edge is the opposite. Say *local-first*, *LAN-only*, *no cloud required*.
- **Hype/membership posturing** ("join the frontier", elite customer club) — conflicts with SADEEM's independence/ownership tone.
- **Marketing fluff and vague superlatives** (OpenCode's explicit rejection) — every claim should be a number or a demonstrable behavior.
- **Mascots/illustration whimsy** (Hermes wing, painted Cursor wallpapers as the main subject) — tasteful, but undermines "serious local tool."
- **Burying Arabic in a locale switcher** — Arabic-first must be visible above the fold, with RTL layout treated as a first-class design, not an afterthought.
- **Fake/dark-pattern urgency, cookie-cutter pricing walls** — keep the pricing/tool story honest and self-serve.

### Proposed homepage hero copy (bilingual)

**English**
- Eyebrow: `SADEEM v11.12 · Local-first AI coding agent for Windows`
- H1: **Your agent. Your machine. Your rules.**
- Subhead: "142 tools, 12 providers, and a playbook that gets smarter every session — running locally, in Arabic or English. No cloud, no lock-in."
- Primary CTA: `Download for Windows` · Secondary: `Read the docs` · Inline: `winget install sadeem` (styled as a code chip)

**العربية**
- فوق العنوان: `سديم ١١.١٢ · وكيل برمجة محليّ أولاً لنظام ويندوز`
- العنوان: **وكيلك. جهازك. قواعدك.**
- الوصف: "١٤٢ أداة، و١٢ مزوّداً، ودليل حيّ يزداد ذكاءً كل جلسة — كلها تعمل محلياً، بالعربية أو الإنجليزية. بلا سحابة وبلا قيود."
- الزر الأساسي: `حمّل سديم لويندوز` · الثانوي: `اقرأ التوثيق` · مضمّن: `winget install sadeem` (على شكل مربع كود)

### Six feature one-liners (bilingual)

1. **Local-first by design** — *EN:* "Runs on your machine — your code, keys, and context never leave your disk." *AR:* "يعمل على جهازك — لا يخرج كودك ومفاتيحك وسياقك من قرصك."
2. **142 tools, tuned to taste** — *EN:* "142 tools with Tool Profiles — Essential, Balanced, or Full. You choose the reach." *AR:* "١٤٢ أداة مع ملفات الأدوات: أساسية، متوازنة، أو كاملة — أنت من يحدّد المدى."
3. **A Living Playbook** — *EN:* "A playbook that learns your workspace and gets better every single run." *AR:* "دليل حيّ يتعلّم مساحة عملك ويتحسّن مع كل تشغيل."
4. **12 providers, 20+ MCP servers** — *EN:* "Bring your own keys or run local models — 12 providers and a 20+ MCP catalog, one workspace." *AR:* "استخدم مفاتيحك أو شغّل نماذج محلية — ١٢ مزوّداً وفهرس MCP يضم أكثر من ٢٠ خادماً في مساحة واحدة."
5. **A fleet, not a single agent** — *EN:* "12 subagents on isolated git worktrees — parallel work, clean diffs, zero clashes." *AR:* "١٢ وكيلاً فرعياً على فروع git معزولة — عمل متوازٍ، فروق نظيفة، بلا تضارب."
6. **Automation with receipts** — *EN:* "Proof-gated schedules and LAN-only phone control — automation that shows its work and stays yours." *AR:* "جداول مشروطة بالإثبات وتحكم بالهاتف عبر الشبكة المحلية — أتمتة تُظهر عملها وتبقى تحت سيطرتك."

### Suggested section order
1. Hero (bilingual headline + real product screenshot + code-chip CTA)
2. Stats strip (142 / 12 / 12 / 20+)
3. "You set the rules" — Tool Profiles + proof-gated schedules
4. "A playbook that learns you" — Living Playbook
5. "A fleet, not an agent" — subagents + worktrees Kanban visual
6. Provider-logo band (12 providers / MCP catalog)
7. Role-based "who is it for?" matrix with Arabic + English example prompts
8. Download + specs/FAQ
