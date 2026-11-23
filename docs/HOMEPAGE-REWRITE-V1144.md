# HOMEPAGE REWRITE v11.44 — homepage prose, truth-first

**Scope:** `website/app/page.tsx` (prose constants only), `website/components/home/{HomeContent,TerminalDemo,SEOContent}.tsx`.
No CSS, no `layout.tsx`, no `site.ts`, no download/features pages were edited. The hero mosaic
structure, glyphs and animations were left untouched (Q8 owns them).

**Briefs read:** `docs/FEATURE-TRUTH-V1144.md` (Q1), `docs/DOCS-STYLE-V1144.md` (Q3),
`docs/SEO-WORDS-V1144.md` (Q4), `docs/HERO-POLISH-V1144.md` (Q8), plus the live guard
`tests-v1144-anti-slop.mjs` (Q9) and the parent's direct constraints.
`docs/WEBSITE-COPY-AUDIT-V1144.md` (Q2) **never appeared** after a 22-minute wait; Q1 §13
("INTERNAL details that must NEVER appear") was used as the authoritative leak list instead.

---

## 1. The new H1 (reported to parent)

`website/app/page.tsx:45-47` (EN) and `:45-47` (AR):

- **EN:** **A local-first AI coding agent that learns your workspace.**
- **AR:** **وكيل برمجة ذكي يعمل محلياً يتعلّم مساحة عملك.**

Why: Q4 §3.4 rejected "The agent that grows with you" as brand poetry; this is a
keyword-bearing descriptor (`local-first AI coding agent`), matches the `<title>` topic,
uses only the literal `first` in `local-first`, and describes a shipped mechanism
(the PLAYBOOK.md learning loop) that the lead then explains concretely.

Second H1 (orphan component, kept consistent with Q3's own before/after example):
`website/components/home/HomeContent.tsx:211-213` —
"A local-first AI coding agent / that reads your code / and runs real tasks."
(AR: "وكيل برمجة ذكي يعمل محلياً / يقرأ كودك / ويشغّل مهام حقيقية.")

---

## 2. Before → after samples

### Hero lead and note — `website/app/page.tsx:48-56`

| | Before | After |
|---|---|---|
| Lead | "A local-first coding agent with a living playbook of your workspace — what worked, what failed, what you prefer. Bring your own keys; your machine, your data, your evolution." | "Reads and edits files, runs commands, calls 145 tools. After a run it writes PLAYBOOK.md with a saved revision history. Bring your own key; files, keys and learning notes stay on your machine." |
| Note | "No telemetry · Keys stay on your device · Free during the public season" | "Bring your own key · Files and learning notes stay on your device · Free during the public season" |

`Free during the public season` is preserved verbatim (guard H11). The absolute "No telemetry"
claim was removed per Q1 §12 ("avoid absolute 'no telemetry' unless the parent confirms it").
AR is fully Arabic and carries the same mechanism (`ملاحظات تعلّمك` = learning notes).

### Benefits — `website/app/page.tsx:149-183`

| # | Before | After |
|---|---|---|
| 01 tag/title | "LOCAL BY CONVICTION" / "Your keys stay yours." | "YOUR KEYS" / "Your keys stay yours." Body now says credentials stay on the machine, calls go direct, **the provider bills the user**, and keeps the test-required "Start free without an account; sign in only when you want to sync…". |
| 02 tag/title | "A LIVING PLAYBOOK" / "It remembers what worked." | "PLAYBOOK.md" / "It writes PLAYBOOK.md." Body names the file, the version history with diffs, and the advisory rule: "Your current request wins; learned facts never become rules." (Q1 §3) |
| 03 tag/title/body | "145 TOOLS + MCP" / "Real tools, clean shelves." / "…three clear profiles… Nothing is deleted — the model simply sees the right shelf…" | "145 TOOLS · MCP" / "145 tools, every one callable." / "145 tools ship with schemas and routing descriptions. **Nine profiles** change what the model sees for a turn, not what it may call — any tool stays callable by name. Connect your own MCP servers when you need them." (Q1 §2, §11) |

Section heading changed from "Three things done right." to "Three things you can verify."
(`page.tsx:152-153`) — a claim you can check, not a hype adjective.

### Proof — `website/app/page.tsx:185-198`

| | Before | After |
|---|---|---|
| Figures | 145 REAL TOOLS · 12 PROVIDERS · **100% LOCAL** | 145 TOOLS · **16 SPECIALISTS** · 12 PROVIDERS |
| Heading | "By the numbers, honestly." | "Three counts, no estimates." (`page.tsx:187-188`) |

`100% LOCAL` was an overstatement (network features exist: provider calls, web tools, MCP)
and is a hard FAIL in the anti-slop guard. `16 specialists` matches `electron/agent/agents.ts`.

### Closing CTA — `website/app/page.tsx:200-210`

"Make it yours." / "Free during the public season. No subscription, no telemetry — just your agent, on your machine."
→ "Open a folder, run a task." / "Free during the public season. Add your own key, open a workspace and review the diff before anything ships." (`:202-206`)

### SEO explainer — `website/components/home/SEOContent.tsx`

| Line | Before | After |
|---|---|---|
| 25 | "The local-first AI coding agent" | "A local-first AI coding agent" (definite article removed, Q9) |
| 28 | "…a lot of claims. Here is what SADEEM actually does — no unlimited-free promises, no magic offline mode…" | "…Here is what SADEEM does in this release: which files it writes, which calls leave your machine, and which steps wait for your approval." |
| 82 / 87 | "SADEEM ships a curated, install-ready catalog of **20+ servers**" / "أكثر من ٢٠ خادماً" | "Connect your own MCP servers. GitHub, Figma, Supabase, Playwright and Notion are common choices, not a bundled catalog." / "اربط سيرفرات MCP التي تختارها… خيارات شائعة، ليست كتالوجاً مرفقاً." |
| 119 / 123 | FAQ: "SADEEM ships a curated catalog of **20+ install-ready MCP servers**" / "أكثر من ٢٠ خادم MCP" | FAQ: "SADEEM lets you add your own MCP servers - GitHub, Figma, Supabase, Playwright, Notion and more are common choices." / AR equivalent with no count. |
| 54, 68, 80 | "frontier quality", "eight more providers" | Provider calls "bill you"; permission modes and visible tool calls named instead of adjectives. |

The four **English** FAQ strings at `SEOContent.tsx:98-133` are now byte-for-byte identical to
`website/app/layout.tsx:84-101` `FAQ_ENTRIES`, preserving the FAQPage JSON-LD mirror contract.

### Orphaned home components (owned, rewritten anyway)

- `HomeContent.tsx:28-33` — metrics dropped false `20+ MCP servers`, `12 subagents`, `100% local`;
  now 145 tools / 16 specialist agents / 12 providers / 2× deep-effort steps.
- `HomeContent.tsx:211-233` — hero H1 and lead rewritten per Q3; the internal billing leak
  "Free while the payment gateway is upgraded" was replaced with "Free during the public season".
- `HomeContent.tsx:63-173` — all nine feature cards made checkable. Fixed the false claim
  "Research agents stay read-only" (all 16 agents have the full registry — Q1 §4), replaced
  "MCP catalog, install-ready" with "Connect your own MCP servers", and grounded worktrees,
  cron proof gating, skills/plugins, LSP/DAP and privacy in real nouns.
- `TerminalDemo.tsx:111-123,342` — illustrative answer no longer invents test counts; footer
  dropped "100% on your machine" for "keys on your machine".

---

## 3. Truth constraints applied (Q1)

- No `preview_open` or `worktree_list` marketed as agent-callable tools. No tool name is
  presented as one-call preview; generic "the app previews the built page" language only.
- DNA Autopsy is **not** presented as a separate feature; the rewrite does not mention it.
- Tool profiles: **nine**, described as an advertisement view (strong models see all 145);
  the old "three shelves, nothing deleted" framing is gone (`page.tsx:178`).
- No "the AI never lies / always uses all tools / never stops". The proof/gate language is
  always about the harness checking claims, never about model infallibility.
- Every BYOK surface says the user pays the provider (`page.tsx:160`, `SEOContent.tsx:65-67`,
  `HomeContent.tsx:403-404`). No "free inference" claim.
- Q1 §13 leaks scrubbed: no env var, no 90%/120-turn thresholds, no build tags/hashes, no
  staging/placeholder/debug/billing-state language, no 64-hex decoration in the rewritten files.
- Only publishable numbers used: **145 tools, 16 specialists, 12 providers, 2× deep effort**.
- No "best / first / powerful / seamless / unlock / supercharge / revolutionary" (or AR
  equivalents) in any rewritten string — confirmed by grep and by `tests-v1144-anti-slop.mjs`.

---

## 4. Q9 fixes reported with exact line numbers

- `website/components/home/SEOContent.tsx:25` — "The local-first AI coding agent" → "A local-first AI coding agent".
- `website/components/home/SEOContent.tsx:82,87,119,123` — all four "20+ MCP servers" / "أكثر من ٢٠ خادماً" claims removed.
- `website/components/download/DownloadPage.tsx` — **not edited** (another agent owns it). The definite
  article Q9 flagged is already gone there: line 413 now reads "SADEEM is a local-first coding agent for Windows…"
  (lowercase "a"); the old line 422 is now a download icon/button.
- `node tests-v1144-anti-slop.mjs` → **FALSE: 0**, **SLOP: 0 hard**, **HARD FAILURES: 0**.
  The remaining `GUARDS: 16 pass / 1 fail` is `tests-v1142-seo.mjs` (7 FAILs), all in
  `layout.tsx` / `site.ts` / changelog / auth route metadata — outside this workstream.

---

## 5. Test assertions updated (all reported)

| File | Assertion | Before → After | Why |
|---|---|---|---|
| `tests-v1140-hero-honesty.mjs:52-54` | hero-slice anchor | `ProductInUse — a faithful` → `ICON FIDELITY` | **Pre-existing bug**: the old marker was deleted with the v11.43 console, so the hero slice was empty and H1/H7 failed at baseline (11 PASS / 3 FAIL before any edit). Restores the intended scope; no weakening. |
| `tests-v1140-hero-honesty.mjs:188` | H14 `countsHonest` | `optional user-configured MCP servers` → `(?:optional user-configured )?MCP servers` | site.ts:79 now honestly says "MCP servers" after the other agent's rewrite; the old literal was obsolete, not a truth check. Still requires `16 specialist agents` and rejects 20+/12-subagent lies. |
| `tests-v1141-hero-mosaic.mjs:104-109` | M9 copy list | old poetry headline + "No telemetry" note → new descriptor + BYOK note | This is exactly an assertion encoding **old slop copy**; updated to the honest H1/CTA/note, not weakened. |

No other test file was touched.

---

## 6. Verification (all run after the final edit)

```
cd website && npx tsc --noEmit                 → PASS (no output)
cd website && npm run build                    → PASS (Next 16.4.6, 14/14 static pages)
grep banned words / leaks in 4 owned files     → 0 hits
node tests-v1140-hero-honesty.mjs              → 14 PASS / 0 FAIL / 10 WARN (OOS only)
node website/tests-homepage-seo.mjs            → 8 PASS / 0 FAIL / 1 WARN
node tests-v1141-hero-mosaic.mjs               → 18 PASS / 0 FAIL
node tests-v1144-anti-slop.mjs                 → hard failures 0; FALSE 0; 16 guards pass / 1 fail
                                                  (seo(47): layout/changelog/auth metadata — other agents)
```

`WARN` rows are out-of-scope advisory scans (`docs/RESEARCH.md`, `README-v7.1.0.md`,
`app/auth/page.tsx:340` Date.now) and were not modified.
