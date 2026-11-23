# PAGES-REWRITE-V1144 — Q6 prose rewrite report

**Agent:** Q6 · **Date:** 2026-11-22 · **Version:** v11.12.0

## Briefs used

- `docs/FEATURE-TRUTH-V1144.md` (Q1) — authoritative truth map; every claim below is grounded in its `file:line` evidence.
- `docs/DOCS-STYLE-V1144.md` (Q3) — developer-docs register (definition → verb list → imperative steps → copyable commands → explicit limits).
- `docs/SEO-WORDS-V1144.md` (Q4) — ready-to-use metadata table + the on-page H1 fixes + R7/R9.
- Parent-session verified fact: the CLI is **published** as `sadeem-cli` (npm version 11.12.1), `npm i -g sadeem-cli` works, `sadeem version` → 11.12.0, bins `sadeem` + `kodex`. Documented as shipped, not as a future promise.
- Q7 handoff: remove hash/checksum wording from `SEO.download.description`.
- **Q2 (`WEBSITE-COPY-AUDIT-V1144.md`) was never produced.** I audited the live source of every page I own directly instead. Q1 §13 + Q7's handoff were treated as the authoritative internal-leak lists.

## Ownership respected

Edited only visible prose (and metadata constants) in the files I own. No CSS, components, visual structure, `app/page.tsx` (Q5), `app/download/page.tsx` or `components/download/*` (Q7) were touched. `app/layout.tsx` was edited **only** on the parent session's explicit follow-up instruction (keywords meta + hreflang); it was outside my original boundary.

---

## 1. `website/app/features/page.tsx`

| # | Before (old line) | After (new line) | Why (Q1 evidence) |
|---|---|---|---|
| 1 | H1 `Everything under the hood.` (806-809) | `145 tools, MCP servers and subagents.` (818) | Q4 §3.4: descriptive H1, not brand poetry. |
| 2 | Lead "grounded tour… no vaporware" (812-815) | Definition lead: "A local-first coding agent for Windows. It reads and edits files, runs commands and calls 145 tools…" (821) | Q3 Rule 1; Q1 §12 truth spine. AR fixed `١٤٢ أداة` → `١٤٥ أداة` (82). |
| 3 | Tools group "A tool for every move"; chips `list_dir/read_file/edit_file/fs_browse` (78-103) | "Read, edit and run" + 4 value rows: map workspace → write/run → build artifacts → data & QA (79-141) | Q1 §2 groups A–H; §11 profiles are a **view**. |
| 4 | MCP "Twenty-plus curated servers…" / "Install in one command" / Figma-Blender-Maya (106-130) | "MCP servers" with the three real transports, poisoning scan / quarantine / hash pinning, and "available in every profile" (114-160) | Q1 §9: no "20+" count was ever safe; removed invented publisher labels and catalog categories. |
| 5 | Subagents "own context window… **tool restrictions**… Research agents stay **read-only by design**" (134-137) | "Sixteen specialists… **full tool registry**… differ by system-prompt role, not capability tier" (142) | Q1 §4: every specialist has `tools: '*'`; there is **no** read-only specialist. |
| 6 | Playbook "**The signature feature**" / chips `playbook-history.json` (156-172) | "Living Playbook" — four learned kinds, version history with diffs, current request overrides, facts never become bans. Added "DNA Insights" lens row; removed sidecar filename chip (163-205) | Q1 §3, §5, §12, §13 E. No superlative, no internal filename. |
| 7 | "Proof-gated schedules… proof — test runs, diffs and verification" (218-220) | "Cron jobs with a test gate… result suppressed if workspace tests fail… event ledger with next-run time, error count and duration" (240-243) | Q1 §6 + §12. |
| 8 | Editor "**Editor-grade** intelligence" (227) | "Code intelligence & debugging" (270) | Q3 Rule 8: drop vague adjective, name the real controls. |
| 9 | "Verification before done…" (245-247) | "Checks before a report… gates check evidence; they cannot guarantee the model's answer is wise" | Q1 §1.7 (SHIPPED **mechanism** ⚠) + §12 "never promise AI never lies". |
| 10 | Privacy "no relay, **no telemetry, no training on your code**"; chips `no telemetry`, `taint` (255-269) | "Keys and files stay local" — keys in local settings, provider bills you, plain markdown/JSON files, real approval modes (266-300) | Q1 §12: avoid absolute privacy claims; §13 C: no taint labels. |
| 11 | STATS `LOCAL / FIRST, BYOK` (280) | `BYOK / KEYS STAY ON YOUR MACHINE` (287-293) | Q1 §12 "100% LOCAL" qualifier. |
| 12 | TERM `sadeem --version`, `profile balanced # essential/balanced/full` (283-291) | `sadeem version`, `9 views`, `strong models see all 145` (295-301) | Q1 §11: **9** profiles, view-only, strong models see full registry. |
| 13 | Keys diagram "YOUR KEYS NEVER LEAVE" | "CREDENTIALS LOCAL · CALLS DIRECT" | Avoid absolute claim; state the mechanism. |
| 14 | "Name the move, make the move." / "See it running." / "Ask something real." | "Real tool names." / "What a run reports." / "Describe the task." | Q3 Rule 5: imperative + real nouns. |

No `preview_open` or `worktree_list` appears anywhere (Q1 §2/§7: dead tools). All chips are real CORE_DEFS names (verified in `electron/agent/tool-defs.ts`).

## 2. `website/app/docs/page.tsx`

| # | Before | After | Why |
|---|---|---|---|
| 1 | `INSTALL_CODE` = installer + ZIP only (73-77) | Adds the **published** CLI block: `npm i -g sadeem-cli`, `sadeem version # prints 11.12.0`, `sadeem run "…"`, `sadeem` (79) | Parent-verified shipped CLI; Q3 Rule 4 (copyable command). |
| 2 | 11 sections: install → api-key → models → profiles → mcp → … | 14 sections in order **quickstart → concepts → CLI → api-key → models → tools → MCP → subagents → playbook → schedules → worktrees → config → accounts → privacy** (86-440) | Q3 Rule 7 / Q4: real product-docs structure, ending in config/reference. |
| 3 | No CLI section | New `cli` section with install, run, REPL, models/config/verify/journals, `--workspace`, `--mode default`, `--yes`, REPL slash commands, and an honest limit about keystore keys (152-188) | Q1 §8 + parent fact. Env-var **names** not published (Q1 §13 B). |
| 4 | "Tool profiles … ~30 core tools … ~134 tools" (156-161) | "145 tools … grouped by what they do [8 value groups] … nine profiles … every tool callable by exact name … strong models see full registry" (227-259) | Q1 §2/§11/§12: no fake counts, 9 not 3. |
| 5 | "Keys are encrypted at rest and never cross a SADEEM server" (124-126) | "Keys stay in local settings and go straight to the provider you chose. Your provider bills you." | Q1 §12: no "free inference", no unverifiable encryption claim. |
| 6 | MCP "last 100 tool calls" (190) | "Health state and the call log" | Q1 §14: only 145/16/12/3-instruments/2× are publishable numbers. |
| 7 | "Auto-quarantine blocked servers whose descriptions look poisoned" | Poisoning scan + hash pinning + call log + no profile filtering (308-329) | Q1 §9. |
| 8 | "New in v11.12… learning is visible rather than silent" | Playbook writes 4 kinds into `.surnia/PLAYBOOK.md`, version history with diffs, advisory override, DNA Insights lens (308-330) | Q1 §3/§5/§12. |
| 9 | "Schedules vs flows" vague proof (242-244) | Headless same-engine run, test failure suppresses result, durable event ledger (331-349) | Q1 §6. |
| 10 | New `config` section | Profile + permission mode + `.surnia/` plain files (365-393) | Q3 Rule 7: config/reference track. |
| 11 | H1 "The field manual." (479-481) | "SADEEM documentation." (609-611) | Q4 §3.4. |
| 12 | Lead "honest about what lives where" | Quickstart-first lead naming CLI, keys, MCP, subagents, playbook | Q3 Rule 1 / Rule 6. |
| 13 | Back-to-top `href="#install"` | `href="#quickstart"` (643) | Keep anchor valid after rename. |
| 14 | Privacy "This website sends no telemetry" | Concrete local-storage/direct-call statements (424-450) | Q1 §12. |

## 3. `website/app/pricing/page.tsx`

| # | Before | After | Why |
|---|---|---|---|
| 1 | H1 `Free today. Yours forever.` (210-214) | `Free during the public season.` (211-213) | Q4 §3.4: "forever" unsupported by the licensing model. |
| 2 | Visible label `FREE_SEASON = true` (235) | `PUBLIC SEASON` / `EVERY FEATURE OPEN` (235-236) | Q1 §13 D: internal flag/gate never on the public site. |
| 3 | "Checkout is disabled… planned paid surface, **not a store**" (250-252) | "Every feature is open… nothing is charged… a checkout link will appear when a gateway is connected" | Honest, no internal mechanism. |
| 4 | Free tier "**Unlimited runs** on your own API keys"; "**2 MCP servers** · community support" (41-45) | "Runs on your own API keys — **your provider bills you**"; "MCP servers, skills and 16 specialist agents" (41-45) | Q1 §13 D + parent: no free-inference claim, no invented cap. |
| 5 | Owner tier "**Unlimited MCP · device tools · parallel calls**" (58) | "A signed key activates the license in the desktop app" (58) | Q1 §13 D: gate names are internal. |
| 6 | COMPARE `MCP servers: 2 / Unlimited`; `Device tools · parallel calls · 16 agents` (89-96) | `Open during the season / Open`; `Specialist agents: 16 / 16` (92-95) | Same. Prices, `FOUNDING`/`LIST`, checkout logic, `FREE_SEASON` constant and button states **unchanged**. |
| 7 | BUY_ANSWER named `FREE_SEASON`, gateway/key-minting internals (110-123) | Season state in plain words; no flag or config names (111-124) | Q1 §13 D. |
| 8 | fine print `FREE_SEASON = true` (327-329) | "Nothing is charged during the public season." (327) | Same. |
| 9 | "Add NEXT_PUBLIC_CHECKOUT_URL…" (259-261) | "No payment gateway is configured…" | Q1 §13 B: env var names never published. |

## 4. `website/app/auth/page.tsx`

| Before | After | Why |
|---|---|---|
| Lead "Three steps. One click back to the app. **No credentials leave this machine.**" (458) | "…The password stays in this browser; the link carries only your name, email, plan and an optional license key." (458) | Pairing *does* send name/email in the deep link; be exact. |
| Footnote "Your keys, your machine, your playbook." (724) | "Keys stay here; provider calls go direct." (724) | Q1 §12: no absolute privacy claim. |

The rest of the page (pair-code mechanics, local SHA-256+salt password, format-only license check, deep link) was already honest and was left intact.

## 5. `website/app/changelog/page.tsx`

- **Removed** the page-level `metadata` export (`title: 'Changelog'`, short description, old lines 1-8) and the `Metadata` type import. The good `SEO.changelog` metadata from `app/changelog/layout.tsx` now wins (new lines 1-8).
- Also refreshed the now-stale source comment in `app/changelog/layout.tsx:5-8` (it still said the page "stays untouched"). No metadata logic changed.
- **Not edited:** the changelog body lives in `components/download/ChangelogPage.tsx`, owned by Q7. Dated-entry prose there remains Q7's responsibility.

## 6. `website/app/(sitemaps)/seo.tsx`

- `routeMetadata()` alternates: removed `languages: { ar: route, en: route, 'x-default': route }`; kept `canonical: route` (new lines 20-25). Q4 R9 / parent: no crawlable `/ar` or `/en` routes exist, so three tags at one URL were a no-op.

## 7. `website/app/layout.tsx` *(parent-directed exception)*

- Deleted the 22-entry `keywords` meta array (old 119-142) → explanatory comment at new line 119. Q4 R7: Google has ignored the tag since 2009.
- Removed `languages: { ar: '/', en: '/', 'x-default': '/' }` from `alternates`, kept `canonical: '/'` (new 124-132). Q4 R9.
- **Not changed:** `<html lang="ar" dir="rtl">`. Q4 R8 language mismatch is **noted, not silently "fixed"**: the UI is Arabic-first RTL, but `<title>`/OG are English. A real fix requires crawlable `/ar` + `/en` metadata routes (server-rendered, not a JS toggle), which is a routing change outside this scope. Flagged for the parent.

## 8. `website/lib/site.ts` — SEO block only

Titles/descriptions replaced with Q4 §4 table values (front-loaded category/action, one natural phrase per route):

| Constant | New value (new line) |
|---|---|
| `SEO.home` | `SADEEM — Local-First AI Coding Agent with BYOK & MCP` (72) |
| `SEO.features` | `145 Tools, MCP & Subagents — SADEEM Features` (77) |
| `SEO.pricing` | `Pricing — Free Public Season & One-Time License \| SADEEM` (82) |
| `SEO.download` | `Download SADEEM for Windows — v11.12.0` (87); desc now "NSIS installer or portable ZIP. Local-first and free during the public season." (89) — **hash/checksum wording removed per Q7** |
| `SEO.docs` | `SADEEM Docs — Setup, API Keys, MCP & Tools` (92) |
| `SEO.changelog` | `Changelog — SADEEM Release History` (97) |
| `SEO.auth` | `SADEEM Account Pairing — Desktop Sign-In` (102) |

All titles ≤ 60 chars, all descriptions ≤ 160 chars. `download` URLs, `exeSha256`/`zipSha256`, `freeSeason`, `checkoutUrl`, `license` were **not touched**.

## 9. Guard assertion update (old slop only)

- `website/tests-homepage-seo.mjs:224-230`: S3 previously required a `keywords:` meta key and counted stuffed entries. Rewritten to require the 8 real metadata surfaces **and assert `keywords` is absent**. No other assertion was changed.

---

## Verification

```
cd website && npx tsc --noEmit                 # clean, 0 errors (run twice)
cd website && npm run build                    # ✓ compiled, 14/14 static pages, all routes present
grep (banned words / internal strings)         # clean across all edited files
node website/tests-homepage-seo.mjs            # 8 PASS / 0 FAIL / 1 WARN (S3 now green)
node website/tests-v1133-auth-lic.mjs          # 8 PASS / 0 FAIL
node website/tests-v1128-site-guard.mjs        # 3 PASS / 5 FAIL / 4 WARN — all 5 FAIL are pre-existing
                                               #   and in Q5's scope (home.css keyframes, reduced-motion,
                                               #   #watch showcase, unwired visuals). E1/E2 bilingual PASS.
node website/tests-app-demo.mjs                # 5 PASS / 6 FAIL / 3 WARN — all 6 FAIL are in Q5's
                                               #   app/page.tsx + home.css scope, pre-existing.
```

Banned-word grep: no `unbeatable / powerful / seamless / unlock / supercharge / revolutionary / first-as-superlative`, no `20+ MCP`, `12 subagents`, `100% LOCAL`, `FREE_SEASON =`, `NEXT_PUBLIC_`, `KODEX_`, `SURNIA_`, `134 tools`, `playbook-history`, `last 100`, `read-only by design`, `The signature feature`. Remaining matches for "first" are literal ("Plan approval first", "local-first", "before the first task", "Sign up first") and are not superlatives.

## Open items for the parent

1. **Q2 doc absent** — produced no `WEBSITE-COPY-AUDIT-V1144.md`; I audited source directly.
2. **Changelog body** is in Q7's `components/download/ChangelogPage.tsx`; I could only fix its metadata override.
3. **Language mismatch (Q4 R8)** noted, not fixed; needs crawlable `/ar`/`/en` metadata routes.
4. `tests-v1128-site-guard.mjs` and `tests-app-demo.mjs` failures are Q5 scope and were not "fixed" by weakening assertions (they do not encode slop).
