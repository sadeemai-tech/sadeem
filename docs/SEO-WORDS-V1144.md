# SEO-WORDS-V1144 — دراسة الكلمة بكلمة / Word-by-word SEO study

**Target:** `sadeem-ai.com` · **Version studied:** v11.12.0 · **Date:** 2026-11-22
**Scope:** research + documentation only. No source file was edited. No search-volume data was invented.

**Method (so you can trust the quotes):**
- Google Search Central pages fetched as Markdown on 2026-11-22.
- Ahrefs beginner/on-page guides fetched as Markdown on 2026-11-22.
- Competitor `<title>`, `<meta name="description">` and first `<h1>` read from **raw HTML** with an HTTP client (User-Agent `Mozilla/5.0`), same date. Quotes below are verbatim from those responses; where the raw response had an encoding artefact, it is called out.
- Character counts computed directly from the strings in `website/lib/site.ts`, not estimated.

---

## 0. الحصيلة / TL;DR — brutal version

| # | Finding | Verdict |
|---|---|---|
| 1 | `website/app/changelog/page.tsx:5-8` exports its **own** `title: 'Changelog'` and a description. Next.js merges child metadata over parent metadata, so the carefully written `SEO.changelog.title` at `website/app/changelog/layout.tsx:8` **does not win**. The SERP title becomes `Changelog · SADEEM` via the root template at `website/app/layout.tsx:116`. | Real bug |
| 2 | `website/app/layout.tsx:119-142` is a 22-item `keywords` meta array. Google has ignored this tag since 2009 and still does not support it. It is also mini-keyword-stuffed (`bring your own key` / `bring your own key AI assistant` / `BYOK` / `BYOK AI assistant`). | Delete |
| 3 | `hreflang` self-references the **same single URL** for `ar`, `en` and `x-default` (`layout.tsx:150-153`, `(sitemaps)/seo.tsx:22-24`). That is not hreflang localisation. Google states it does not use hreflang to detect language. A JS language toggle does not change the `<title>` Google crawls. | Architectural gap |
| 4 | Default document is `<html lang="ar" dir="rtl">` (`layout.tsx:195`) but `<title>`, description, OG title and OG description are **English** (`layout.tsx:154-165`). Google says title text should match the primary language/script of the page, and may generate its own title if it does not. | Fix |
| 5 | H1s are brand poetry, not descriptors: home `The agent that grows with you.` (`app/page.tsx:829-836`), features `Everything under the hood.` (`app/features/page.tsx:805-809`), docs `The field manual.` (`app/docs/page.tsx:478-481`). Google's helpful-content test asks whether the heading gives a **descriptive** summary and avoids exaggeration. | Fix |
| 6 | Pricing H1: `Free today. Yours forever.` (`app/pricing/page.tsx:210-214`). "Yours forever" is unsupported by the pricing model in `website/lib/site.ts:34-44` (one-time license *planned*, checkout closed). Overpromise. | Fix |
| 7 | The 7 `SEO.*` title/description strings are actually well made: all titles ≤ 60 chars, all descriptions ≤ 160 chars, all unique. The problem is not the copy — it is what the pages actually render and the language mismatch. | Mostly good |
| 8 | No competitor page uses the phrase "local-first". Kilo/Cursor/Claude Code all lead with **"AI coding agent" / "agentic coding tool"**. "local-first" is our differentiator, but it cannot be the *only* category word. | Keyword strategy |

---

## 1. القواعد / Concrete SEO rules — with real retrieved examples

### R1 — Put the searcher's category word in the `<title>`, front-loaded.
Google: *"Write descriptive and concise text for your `<title>` elements. Avoid vague descriptors like 'Home'…"* and *"Make sure every page on your site has a title specified in the `<title>` element."*
Source: https://developers.google.com/search/docs/appearance/title-link

Ahrefs: *"Front-loaded keywords"* under "Best practice tips for optimizing your SEO titles".
Source: https://ahrefs.com/blog/title-tag-seo/

Real examples retrieved:

| Site | Verbatim `<title>` | Word study |
|---|---|---|
| kilo.ai | `Kilo - Open Source AI Coding Agent in IDE, CLI and Cloud` | Brand → category (`AI Coding Agent`) → 3 concrete surfaces. The category word arrives at character 6. This is the closest match to what SADEEM should do. |
| cursor.com | `AI Coding Agent for Building Ambitious Software \| Cursor` | Category first, brand last after a pipe — the other valid pattern. "Ambitious Software" is filler; ignore it. |
| docs.claude.com | `Overview - Claude Code Docs` | Page label → product → "Docs". Boring, but a developer typing "Claude Code docs" gets an exact match. |
| zed.dev | `Zed - Your last next editor` | "last next" is contradictory poetry. It is memorable, not findable. Note that Zed can afford it because of brand demand — SADEEM cannot. |
| cursor.com/downloads | `Cursor [en dash] Download` (raw fetch returned a replacement character where the en dash should be) | Two words, exact intent. Nothing else needed. |

**Apply to SADEEM:** every title must contain at least one of `AI coding agent`, `BYOK`, `MCP`, `Download`, `Docs`, `Pricing`, `Changelog` — the words people actually type — plus the brand.

### R2 — Length is a guardrail, not a target.
Ahrefs: *"In general, anything under 60 characters is fine"*; *"keep title tags between 50 and 60 characters"*; *"Prioritize title width over length… truncates or rewrites any titles that exceed 600 pixels."*
Source: https://ahrefs.com/blog/title-tag-seo/

Real examples: kilo.ai title = 55 chars; cursor.com = 55; zed.dev = 27; docs.claude.com = 27. Short is fine when the words are the right words. The current SADEEM titles are 33–53 chars — within the guardrail.

### R3 — A description is a one-sentence pitch, not a keyword bag.
Google: *"create descriptions that accurately describe the specific page"*; *"Keep in mind that meta descriptions comprised of long strings of keywords don't give users a clear idea of the page's content, and are less likely to be displayed as a snippet."*
Source: https://developers.google.com/search/docs/appearance/snippet

Ahrefs: meta descriptions are *"not a ranking factor"*, shown *"only 37% of the time"* (their own study), truncate around *"920px (~160 characters) on desktop and 680px (~120 characters) on mobile"*, and the final advice is *"Write it for the reader, not the algorithm"*, *"front-load the value in case it gets truncated"*.
Source: https://ahrefs.com/blog/meta-description/

Real examples retrieved:

| Site | Verbatim description | Word study |
|---|---|---|
| kilo.ai | `Open source AI coding agent for VS Code, JetBrains, CLI, and Cloud. 500+ models at zero markup, your own keys, or local models for privacy.` | 3 named editors + a number + the differentiator (own keys / local models). Specific nouns only. |
| docs.claude.com | `Claude Code is an agentic coding tool that reads your codebase, edits files, runs commands, and integrates with your development tools. Available in your terminal, IDE, desktop app, and browser.` | Verbs: reads, edits, runs, integrates. Zero adjectives. This is the professional docs register. |
| zed.dev | `Zed is a high-performance, multiplayer code editor from the creators of Atom and Tree-sitter.` | Two adjectives, both factual lineage claims. |
| cursor.com | `Built to make you extraordinarily productive, agents turn ideas into code. Accelerate development by handing off tasks to Cursor.` | "extraordinarily productive" = exactly the AI marketing slop we are avoiding. Do not copy this register. |
| kilo.ai/docs | `Build, ship, and iterate faster with the most popular open source coding agent.` | "most popular" is an unprovable superlative — do not copy either. |
| zed.dev/download | `Download Zed, a high-performance, multiplayer code editor from the creators of Atom and Tree-sitter.` | Starts with the action verb, then repeats the product description. |
| cursor.com/downloads | `Download Cursor for macOS, Windows, and Linux.` | 6 words. Perfectly sufficient for a download page. |

**Formula for SADEEM:** `[action/category] + [2-4 verifiable specifics] + [honest availability state]`. No superlatives, no "revolutionary", no "seamless".

### R4 — H1 ≠ `<title>`, but they must agree on topic and intent.
Ahrefs: *"Your page's title tag and your H1 tag are two very different things… If you do, just make sure they align in terms of topic and intent."*
Source: https://ahrefs.com/blog/title-tag-seo/

Google: *"Make it clear which text is the main title for the page… putting the title text in the first visible `<h1>` element on the page."*
Source: https://developers.google.com/search/docs/appearance/title-link

Real H1s retrieved: docs.claude.com overview → `Overview` (generic alone, but the `<title>` supplies the product context); kilo.ai/docs → `Kilo Documentation`; cursor.com/downloads → `Use Cursor everywhere you work` (brand + benefit); zed.dev/download → `1.29.3` (a version number as H1 — technically weak, tolerated only because the title carries the meaning).

**Apply to SADEEM:** a docs H1 of `The field manual.` is the Zed-version-number problem: it means nothing without the title. Use `SADEEM documentation` or `Install and configure SADEEM`.

### R5 — First paragraph must answer "what is this / what does it do" in the first sentence.
Google's helpful-content self-assessment: *"Does the main heading or page title provide a descriptive, helpful summary of the content?"* and *"Does the main heading or page title avoid exaggerating or being shocking in nature?"*
Source: https://developers.google.com/search/docs/fundamentals/creating-helpful-content

The Claude Code description above is the model: four verbs, no adjectives. SADEEM's home lead at `website/app/page.tsx:48-51` is good (`A local-first coding agent with a living playbook of your workspace…`) — the H1 above it is the weak part. The features lead at `website/app/features/page.tsx:810-815` is honest and specific ("no vaporware, no imaginary buttons"); keep it.

### R6 — No keyword stuffing, anywhere.
Google: *"Avoid keyword stuffing… Title text like 'Foobar, foo bar, foobars, foo bars' doesn't help the user."*
Source: https://developers.google.com/search/docs/appearance/title-link

The 22-entry `keywords` array at `website/app/layout.tsx:119-142` is precisely that pattern, in a tag Google ignores (see §3). Delete it. Do not re-create the variants in visible copy either — use one natural phrase per page.

### R7 — The `keywords` meta tag is dead. Stop maintaining it.
Google (2009, with a 2026 editorial note): *"Google doesn't use the keywords meta tag in our web search ranking"*; the note says Google *"still doesn't support"* it.
Source: https://developers.google.com/search/blog/2009/09/google-does-not-use-keywords-meta-tag

### R8 — Language and script of the title must match the page.
Google: *"Use the same language and writing system as the primary content on your pages… If Google determines that a `<title>` element does not match the writing system or language of the page's primary content, we may choose a different text as the title link."*
Source: https://developers.google.com/search/docs/appearance/title-link

Current default HTML is Arabic RTL with English metadata. Either render Arabic metadata for the default document, or make English the default document language. You cannot serve one English `<title>` to Google and claim the page is Arabic.

### R9 — Real hreflang needs real URLs.
Google: *"Google doesn't use hreflang or the HTML lang attribute to detect the language of a page; instead, we use algorithms"*; *"Each language version must list itself as well as all other language versions"*; *"Alternate URLs must be fully-qualified"*; *"If two pages don't both point to each other, the tags will be ignored."*
Source: https://developers.google.com/search/docs/specialty/international/localized-versions

Self-referencing one URL three times (`ar`, `en`, `x-default`) satisfies none of the intent: there are no alternate URLs to point to. It is harmless noise, not localisation.

### R10 — Brand at the beginning or end, separated by a delimiter.
Google: *"consider including just your site name at the beginning or end of each `<title>` element, separated from the rest of the text with a delimiter such as a hyphen, colon, or pipe."*
Source: https://developers.google.com/search/docs/appearance/title-link

Kilo uses `-`, Cursor uses `|`, Claude Code uses `-`. SADEEM uses `—` and `|` inconsistently across routes. Pick one (`—` is fine) and use it everywhere. The table in §4 standardises on `—` for values without a brand suffix and `| SADEEM` for page-label-first titles.

---

## 2. الكلمات المفتاحية / Keywords developers actually type

**Honesty statement:** these are **hypotheses**, built from (a) the product facts in `website/lib/site.ts`, (b) the exact category words used by kilo.ai / cursor.com / docs.claude.com, and (c) how a developer describes a problem. **We have no keyword-tool export, no Search Console data, and no search-volume or difficulty numbers. Do not invent them.** Validate against GSC and a keyword tool before writing any new page for these.

| # | English query (hypothesis) | Intent | Arabic equivalent | Target route | Why plausible |
|---|---|---|---|---|---|
| 1 | `local-first AI coding agent with BYOK` | discover | وكيل برمجة ذكي يعمل محلياً بمفاتيحك | `/` | Exact match to our differentiator pair; nobody else owns "local-first". |
| 2 | `AI coding agent that uses your own API key` | discover | وكيل برمجة يستخدم مفتاح API الخاص بي | `/` | Plain-language version of BYOK — most developers do not know the acronym yet. |
| 3 | `open source AI coding agent for Windows` | discover / download | وكيل برمجة مفتوح المصدر لويندوز | `/download` | kilo.ai leads with "Open Source AI Coding Agent"; MIT licence confirmed at `LICENSE:1`. |
| 4 | `AI coding agent with MCP support` | discover | وكيل برمجة يدعم MCP | `/features` | MCP is a named feature (`site.ts:77`, `layout.tsx:95-96`); competitor kilo.ai lists MCP in its docs title. |
| 5 | `offline capable AI coding assistant with Ollama` | discover | مساعد برمجة يعمل مع Ollama بدون إنترنت | `/docs` | Supported via Ollama/LM Studio — but **offline-capable, not offline-only**. Do not shorten this in copy. |
| 6 | `SADEEM vs Cursor` / `SADEEM vs Kilo Code` | compare | سديم مقابل كيرسور / سديم مقابل كيلو | `/features`, `/pricing` | Branded comparison queries appear once a tool has a name; expected, not proven. |
| 7 | `best BYOK AI coding agent 2026` | compare | أفضل وكيل برمجة بمفاتيح خاصة ٢٠٢٦ | `/features` | "best X" is a standard comparison pattern; we should not publish a "best" claim ourselves. |
| 8 | `download SADEEM for Windows` | download | حمّل سديم لويندوز | `/download` | Branded + action; highest-conversion intent if the brand is known. |
| 9 | `SADEEM documentation MCP setup` | docs | توثيق سديم إعداد MCP | `/docs` | Exact-match branded docs query; kilo.ai/docs uses "Setup, Models, MCP" in its title. |
| 10 | `how to add an MCP server to a coding agent` | docs | كيف أضيف سيرفر MCP لوكيل البرمجة | `/docs` | Problem-shaped query, not product-shaped; only answer it with real content we already have. |
| 11 | `AI coding agent with Arabic interface RTL` | discover | مساعد برمجة عربي بواجهة RTL | `/` | Genuinely rare; this is our defensible long tail, not a volume play. |
| 12 | `coding agent that remembers your project conventions` | discover | وكيل برمجة يتذكر اصطلاحات المشروع | `/features` | Plain-language description of `PLAYBOOK.md` — better than "living playbook" for a first-time visitor. |
| 13 | `SADEEM pricing one-time license` | compare | أسعار سديم رخصة لمرة واحدة | `/pricing` | The unusual "$0 now, one-time later" model generates a real question. State it exactly. |
| 14 | `local alternative to Cursor for VS Code` | compare | بديل محلي لكيرسور يعمل مع VS Code | `/features` | Competitor-adjacent discovery; only valid if the page really compares capabilities. |
| 15 | `privacy-first AI coding assistant no telemetry` | discover | مساعد برمجة يحفظ الخصوصية بلا تتبع | `/`, `/features` | Backed by `website/app/page.tsx:55` ("No telemetry · Keys stay on your device"). |

**Mapping rule:** one query family → one existing route. Do not create thin landing pages for all 15. No new pages are proposed by this document.

---

## 3. تدقيق الموقع الحالي / Audit of current metadata

Legend: **keyword-stuffed** · **vague** · **actually good** · **should change to X**

### 3.1 `website/lib/site.ts` — the SEO constants

| File:line | Current value (short) | Verdict | Reason / change |
|---|---|---|---|
| `site.ts:69-73` | `home` — title 52 ch, desc 155 ch | **actually good** | Category + BYOK + MCP + platform + honest free state. Only improvement: open with the category instead of "SADEEM is" to front-load value (§4 table). |
| `site.ts:74-78` | `features` — title 46 ch, desc 152 ch | **vague** | The leading word `Features` is not a search term; every site has one. **should change to** `145 Tools, MCP & Subagents — SADEEM Features`. |
| `site.ts:79-83` | `pricing` — title 53 ch, desc 159 ch | **vague** | `Free Today, One-Time License Later` — "Later" is undefined and "Free Today" reads temporary without saying what the terms are. **should change to** `Pricing — Free Public Season & One-Time License \| SADEEM`. |
| `site.ts:84-88` | `download` — title 38 ch, desc 158 ch | **actually good** | `Download` + brand + Windows + version; description names NSIS, ZIP and SHA-256. Keep; minor trim in §4. |
| `site.ts:89-93` | `docs` — title 33 ch, desc 158 ch | **vague** | `Field Manual` is house style, not a query. **should change to** `SADEEM Docs — Setup, API Keys, MCP & Tools`. |
| `site.ts:94-98` | `changelog` — title 41 ch, desc 104 ch | **actually good (but unused)** | Copy is fine; it is overridden at `app/changelog/page.tsx:5-8`. Fix the override (see 3.3). |
| `site.ts:99-103` | `auth` — title 40 ch, desc 135 ch | **vague** | `Account Pairing` is internal jargon; search demand is near zero. **should change to** `SADEEM Account Pairing — Desktop Sign-In`. Treat as a utility page, not a traffic page. |
| `site.ts:67-68` | comment: "every title ≤ 60 chars, every description ≤ 160" | **actually good** | Verified by direct count: titles 52/46/53/38/33/41/40; descriptions 155/152/159/158/158/104/135. All within bounds. |

### 3.2 `website/app/layout.tsx` — root metadata

| File:line | Current | Verdict | Reason / change |
|---|---|---|---|
| `layout.tsx:114-118` | `metadataBase`, `title` default + template `%s · SADEEM`, `description` | **actually good** | Correct use of metadataBase and template. |
| `layout.tsx:119-142` | 22-entry `keywords` array | **keyword-stuffed + ignored** | Google has ignored this tag since 2009 (`https://developers.google.com/search/blog/2009/09/google-does-not-use-keywords-meta-tag`). Variants like `bring your own key` / `bring your own key AI assistant` / `BYOK` / `BYOK AI assistant` duplicate the same idea four ways. **should change to:** delete the block entirely. |
| `layout.tsx:150-153` | `alternates` with `ar: '/'`, `en: '/'`, `x-default: '/'` | **vague / ineffective** | Same URL for all three → no real hreflang signal. Google does not use hreflang to detect language. **should change to:** either crawlable `/ar` + `/en` routes with fully-qualified reciprocal tags, or drop the pretense and serve one language per URL. |
| `layout.tsx:154-165` | `openGraph` uses English `TITLE`/`DESCRIPTION`, `locale: ar_AE` | **should change to** Arabic OG title/description for the Arabic default, or switch the default document to English. Currently the OG locale says Arabic while the copy says English. |
| `layout.tsx:166-171` | `twitter` card, English copy | same as above | Same language mismatch. |
| `layout.tsx:172-182` | `robots` index/follow, `max-snippet: -1` | **actually good** | `max-snippet: -1` allows full snippets; no `max-snippet` restriction. |
| `layout.tsx:195` | `<html lang="ar" dir="rtl">` | **actually good (as RTL) / conflict (as SEO)** | Correct for the UI; conflicts with English `<title>`/OG under R8. |
| `layout.tsx:17-112` | Organization / SoftwareApplication / WebSite / FAQPage JSON-LD | **actually good, with one watch item** | No fake rating, no fake price, no SearchAction — honest. But `featureList` at `layout.tsx:61-68` says "Bring your own key (BYOK) across 12 providers"; the FAQ at `layout.tsx:91` names twelve. Consistent. |

### 3.3 Route layouts and page-level metadata

| File:line | Verdict | Reason / change |
|---|---|---|
| `app/features/layout.tsx:8-32` | **actually good** | Full `absolute` title, canonical, OG, Twitter, hreflang, robots. Structure is correct. Values inherit the issues in `site.ts:74-78` and R8. |
| `app/pricing/layout.tsx:7-31` | **actually good** | Same structure. Values inherit `site.ts:79-83`. |
| `app/docs/layout.tsx:7-31` | **actually good** | Same structure. Values inherit `site.ts:89-93`. |
| `app/download/page.tsx:6-30` | **actually good** | Metadata lives in the server page itself — correct, simplest form. |
| `app/(sitemaps)/seo.tsx:16-56` | **actually good, except 22-24** | `routeMetadata()` is DRY and complete; `hreflang` at lines 22-24 repeats the single-URL problem. |
| `app/changelog/layout.tsx:8` | **should change** | Calls `routeMetadata('/changelog', SEO.changelog)` — correct full metadata, but overridden by the page. |
| `app/changelog/page.tsx:5-8` | **vague + real bug** | `title: 'Changelog'` (plain string, 9 ch) + short description override the layout. With the root template the rendered title is `Changelog · SADEEM`, not `Changelog — SADEEM v11.12 Release History`. **should change to:** remove this `metadata` export and let `app/changelog/layout.tsx:8` supply it. |
| `app/auth/layout.tsx:10` | **actually good** | Same `routeMetadata` pattern; inherits `site.ts:99-103`. |

### 3.4 H1 and first paragraph (on-page words)

| File:line | Current | Verdict |
|---|---|---|
| `app/page.tsx:829-836` | H1 `The agent that grows with you.` | **vague** — **should change to** `A local-first AI coding agent that learns your workspace.` The lead at `app/page.tsx:48-51` already says the right thing; promote it into the H1. |
| `app/page.tsx:837-839` | Lead: `A local-first coding agent with a living playbook of your workspace…` | **actually good** — specific, no hype. |
| `app/features/page.tsx:805-809` | H1 `Everything under the hood.` | **vague** — **should change to** `145 tools, MCP servers and subagents.` |
| `app/features/page.tsx:810-815` | Lead: `A grounded tour of the real tool surface — no vaporware, no imaginary buttons.` | **actually good** — honest and distinctive. Keep. |
| `app/pricing/page.tsx:210-214` | H1 `Free today. Yours forever.` | **vague + overpromise** — "forever" is not in the pricing model (`site.ts:34-44`: one-time Owner License *planned*, checkout closed). **should change to** `Free during the public season.` |
| `app/pricing/page.tsx:215-220` | Lead: `BYOK is free forever. During the public season every local feature is open…` | **actually good** (BYOK $0 forever is stated policy; keep the qualification). |
| `app/docs/page.tsx:478-481` | H1 `The field manual.` | **vague** — **should change to** `SADEEM documentation`. |
| `app/docs/page.tsx:482-487` | Lead: `A practical guide to SADEEM v11.12.0 — local-first, bring-your-own-key…` | **actually good**. |
| `app/auth/page.tsx:435` | H1 `Your account, on your device.` | **actually good** — descriptive, matches the title's topic. |
| `app/auth/page.tsx:436-441` | Lead: `SADEEM accounts are created in the desktop app…` | **actually good** — verbs and facts, no adjectives. |
| `app/changelog/page.tsx:10-12` | `<ChangelogPage />` component-driven H1 | Not inspected in this pass (lives in `components/download/ChangelogPage.tsx`); flagged, not judged. |

---

## 4. جاهز للاستخدام / Ready-to-use metadata table

Canonical for every row: `https://sadeem-ai.com/<route>` (`SITE.siteUrl` at `website/lib/site.ts:9`).
Descriptions were re-counted; all are ≤ 160 characters. EN titles ≤ 60 characters.

> **Implementation prerequisite (do not skip):** the Arabic half of this table can only reach Google if it is served from a **crawlable Arabic URL** (e.g. `https://sadeem-ai.com/ar/features`). The current CSS/JS language switch changes the DOM after load; Google still crawls the server-rendered English/Arabic default. With one URL you must pick one language for `<title>`/description. This document does not add routes — that would be a source edit.

| Route | EN `<title>` (ch) | EN description (ch) | AR `<title>` (ch) | AR description (ch) |
|---|---|---|---|---|
| `/` | `SADEEM — Local-First AI Coding Agent with BYOK & MCP` (52) — keep | `Local-first AI coding agent for Windows: BYOK across 12 providers, 145 tools, MCP, living playbook. Arabic RTL and English. Free during the public season.` (154) | `سديم — وكيل برمجة محلي بالأساس بمفاتيحك و MCP` (45) | `وكيل برمجة يعمل محلياً على ويندوز، بمفاتيحك أنت عبر ١٢ مزوّداً، و١٤٥ أداة وMCP ودليل حيّ يتعلّم من عملك. عربي وإنجليزي. مجاني خلال الموسم العام.` (144) |
| `/features` | `145 Tools, MCP & Subagents — SADEEM Features` (44) | `What SADEEM actually ships: 145 tools, 16 specialist agents, MCP servers, a living playbook, worktrees and approval gates for every risky command.` (146) | `ميزات سديم — ١٤٥ أداة و MCP ووكلاء متخصصون` (42) | `ما الذي يشحنه سديم فعلاً: ١٤٥ أداة، و١٦ وكيلاً متخصصاً، وسيرفرات MCP، ودليل حيّ، ومساحات عمل، وموافقة على كل أمر خطير.` (118) |
| `/pricing` | `Pricing — Free Public Season & One-Time License \| SADEEM` (56) | `BYOK is free. Every local feature is open in the public season: no subscription, no credits, no resale of inference. One-time license planned; checkout closed.` (159) | `الأسعار — موسم مجاني ورخصة لمرة واحدة \| سديم` (44) | `المفاتيح مجانية. خلال الموسم العام كل الميزات المحلية مفتوحة: بلا اشتراك أو رصيد أو إعادة بيع للاستدلال. رخصة مالك لمرة واحدة مخططة والدفع مغلق.` (144) |
| `/download` | `Download SADEEM for Windows — v11.12.0` (38) — keep | `Download SADEEM 11.12.0 for Windows 10/11 x64: NSIS installer or portable ZIP. SHA-256 checksums are published for both files. Free during the public season.` (157) | `حمّل سديم لويندوز — الإصدار 11.12.0` (35) | `حمّل سديم 11.12.0 لويندوز 10/11 x64: مُثبّت NSIS أو ملف ZIP محمول، مع تجزئات SHA-256 منشورة لكلا الملفين. مجاني خلال الموسم العام.` (130) |
| `/docs` | `SADEEM Docs — Setup, API Keys, MCP & Tools` (42) | `Install SADEEM, connect a provider key, configure MCP servers and subagents, and use the living playbook. Field manual for v11.12 in Arabic and English.` (152) | `توثيق سديم — التثبيت والمفاتيح و MCP والأدوات` (45) | `ثبّت سديم، اربط مفتاح مزوّد، اضبط سيرفرات MCP والوكلاء المتخصصين، واستخدم الدليل الحيّ. دليل الإصدار 11.12 بالعربية والإنجليزية.` (128) |
| `/auth` | `SADEEM Account Pairing — Desktop Sign-In` (40) | `Pair this browser with the SADEEM desktop app using a short-lived code. The password stays hashed in your browser; nothing is uploaded.` (135) | `اقتران حساب سديم — الدخول من سطح المكتب` (39) | `اربط هذا المتصفح بتطبيق سديم على سطح المكتب برمز قصير العمر. تبقى كلمة المرور مُجزّأة داخل المتصفح، ولا يُرفع أي شيء.` (117) |
| `/changelog` | `Changelog — SADEEM Release History` (34) | `SADEEM releases from v10.3.0 to v11.12.0, with the changes, fixes and tool updates taken from the repository release notes.` (123) | `سجل الإصدارات — تاريخ إصدارات سديم` (34) | `إصدارات سديم من ١٠٫٣٫٠ إلى 11.12.0، مع التغييرات والإصلاحات وتحديثات الأدوات من ملاحظات الإصدار في المستودع.` (108) |

### 4.1 hreflang block — shape to use once `/ar` and `/en` exist

Example for `/features` (every language version must carry the identical, fully-qualified, reciprocal set):

```html
<link rel="canonical" href="https://sadeem-ai.com/features" />
<link rel="alternate" hreflang="en" href="https://sadeem-ai.com/en/features" />
<link rel="alternate" hreflang="ar" href="https://sadeem-ai.com/ar/features" />
<link rel="alternate" hreflang="x-default" href="https://sadeem-ai.com/features" />
```

With `hreflang="en-US"` instead of `en` if the English target is specifically the US; `ar` (language-only) is correct for generic Arabic per Google's ISO 639-1 guidance. Each of the three URLs must list all three. Do not point `ar`, `en` and `x-default` at the same URL — that is the current no-op.

### 4.2 Style contract for whoever implements this

1. One delimiter family: `—` inside a title, `| SADEEM` only when the page label comes first.
2. Front-load the category/action word; brand at the end (or brand-first on `/` only, matching Kilo).
3. Description: start with a verb or the category; 3–4 verifiable specifics; end with the honest availability state.
4. Never: `best`, `#1`, `first`, `revolutionary`, `seamless`, `powerful`, `unlock`, `supercharge`, `extraordinarily productive`, `most popular`.
5. Never claim offline (only offline-capable with a local model), never claim a paid price, never claim ratings.
6. Arabic titles in Arabic script; `BYOK`, `MCP`, `SHA-256`, version numbers stay Latin as proper nouns — that matches the page's own mixed technical register.

---

## 5. ما لم نقلّه / What this document deliberately does NOT claim

- **No search volumes, no difficulty scores, no CTR forecasts.** All numbers here are character counts of strings we retrieved or wrote, or percentages Ahrefs attributes to its own study.
- **No competitor "copy this" recommendation** for Cursor's "extraordinarily productive" or kilo.ai/docs' "most popular" — those are the slop register we are avoiding, even when a competitor uses them.
- **No claim that SADEEM is offline.** `layout.tsx:85-88` correctly says offline-*capable* with a local model. Metadata keeps that qualification out rather than compressing it into a false "offline AI coding agent".
- **No fake metrics in structured data.** The existing `SoftwareApplication`/`Offer` schema with `price: 0`, no `aggregateRating`, and no `SearchAction` is the right call; leave it.
- **"Open source" in keyword #3 is supported** by `LICENSE:1` (MIT). It is not put in the recommended titles to avoid overreaching beyond what the licence file proves about shipped binaries.
- **No source edits were made.** `docs/SEO-WORDS-V1144.md` is the only file created.

---

## 6. المصادر / Sources retrieved 2026-11-22

| Source | URL | Used for |
|---|---|---|
| Google Search Central — title links | https://developers.google.com/search/docs/appearance/title-link | R1, R2, R4, R6, R8, R10; vague titles, stuffing, language/script, main H1, branding delimiter |
| Google Search Central — snippets | https://developers.google.com/search/docs/appearance/snippet | R3; unique descriptions, keyword lists, programmatic descriptions |
| Google Search Central — helpful content | https://developers.google.com/search/docs/fundamentals/creating-helpful-content | R5; descriptive heading, avoid exaggeration, E-E-A-T |
| Google Search Central — localized versions | https://developers.google.com/search/docs/specialty/international/localized-versions | R9; hreflang reciprocity, fully-qualified URLs, x-default, Google does not use hreflang for detection |
| Google Search Blog (2009, updated note) | https://developers.google.com/search/blog/2009/09/google-does-not-use-keywords-meta-tag | R7; meta keywords ignored |
| Ahrefs — title tags | https://ahrefs.com/blog/title-tag-seo/ | R1, R2, R4; front-loaded keywords, <60 chars, 600px, title vs H1 |
| Ahrefs — meta descriptions | https://ahrefs.com/blog/meta-description/ | R3; 37% display study, ~160/~120 chars, active voice, match intent |
| kilo.ai (home) | https://kilo.ai | Title + description quoted in R1/R3 |
| kilo.ai/docs | https://kilo.ai/docs | Title + description + H1 quoted in R1/R3/R4 |
| zed.dev (home) | https://zed.dev | Title + description quoted in R1/R3 |
| zed.dev/download | https://zed.dev/download | Title + description + H1 quoted in R1/R3/R4 |
| cursor.com (home) | https://cursor.com | Title + description quoted in R1/R3 |
| cursor.com/downloads | https://cursor.com/downloads | Title + description + H1 quoted in R1/R3/R4 |
| docs.claude.com — Claude Code overview | https://docs.claude.com/en/docs/claude-code/overview | Title + description + H1 quoted in R1/R3/R4 |
| anthropic.com (home) | https://www.anthropic.com | Brand-first home-page title pattern |

All competitor pages returned HTTP 200 at retrieval time.
