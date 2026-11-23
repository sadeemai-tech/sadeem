# INTEGRATION-V1143 — FLEET INTEGRATION AUDIT (DIAGNOSIS ONLY)

- **Date:** 2026-11-22
- **Role:** Fleet integration auditor. **No source edits made.** Only scratch analysis scripts under `D:\ORION\data\cache\tmp\opencode\`.
- **Method:** Two full passes of every required command plus source scans. Pass 1 caught the tree mid-rewrite; **all status values below are from the FINAL pass** unless explicitly marked "pass 1".

---

## VERDICT (blunt)

**Builds are green and all 15 guards pass (198 checks). But the honesty pass is NOT clean:** the features page still publishes two false stat tiles — **`20+ MCP SERVERS` and `12 SUBAGENTS`** at `website/app/features/page.tsx:278-279`. The v1142 report called these "RESOLVED"; in this tree they are **still live and rendered**. No guard checks them, which is why every suite is green while the claim is false.

Two secondary findings: **160 orphan CSS selectors** left behind by the P1 "WATCH IT WORK" removal (dead, invisible, but real code debt), and **3 pre-existing import-cycle SCCs**, one of which now contains v1143-touched files (`prompts.ts`, `engine.ts`, `proof`).

The v1142 hero CSS collision (`.hm-code i`) **is fixed**. No conflict markers, no duplicate i18n keys, no duplicate registry rails, no cross-file CSS property conflicts, no duplicate `@keyframes`.

**Do not merge the website half on the strength of the green guards alone — fix H1/H2 first.**

---

## TREE MOVES OBSERVED (why pass 1 mattered)

Pass 1 ran while sibling agents were rewriting `website/app/page.tsx`. Both failures below are **transient, gone in the final pass** — not defects to chase:

| When | What was seen | Cause | Final |
|------|---------------|-------|-------|
| pass 1 | `cd website && npx tsc --noEmit` → **86 errors**, all `app/page.tsx` (TS2339/TS2551/TS7006). Line numbers drifted mid-capture (L965–L1311 on first capture, L993–L1339 on second). Every error was on a deleted `DEMO.*` field: `index`, `label`, `title1`, `title2`, `lead`, `more`, `railMore`, `headTools`, `gerund`, `clock`, `phases`, `toolsStat`, `tokens`, `interrupt`, `reasoningLabel`, `proof`, `msgPhase`, `placeholder`, `filesHead`, `fileMeta`, `preview*`, `tool2Name`/`tool2Path`/`tool2Duration`/`tool2Result`, `answer`, `caption`. | P1 agent removed the `DEMO` fields at 8:05 PM before removing the JSX that consumed them. `website/docs/REMOVE-SECTION-V1143.md:13-27` documents exactly this removal. | **PASS (0 errors)** |
| pass 1 | `cd website && npm run build` → **FAIL**: `ReferenceError: ProductInUse is not defined` at `app/page.tsx:868:8` during prerender of `/`. | Same transient: `<ProductInUse />` still rendered after its definition was deleted. | **PASS (14 static routes)** |

`tests-v1142-seo.mjs` passed on pass 1 against **stale `.next` artifacts** from an earlier build; it was re-run after the fresh build and still **47/47**.

---

## COLLISION TABLE

| ID | Sev | Collision | file:line | Impact / why it matters | Fix (not applied) |
|----|-----|-----------|-----------|--------------------------|-------------------|
| C1 | **MEDIUM** (debt) | Orphan selectors after P1 removed the WATCH IT WORK section | `website/app/home.css:185-288` (§2 PRODUCT IN USE) + `:381+` (§6 APP MOCK): **152** `.demo-*` selectors with zero JSX matches; `website/app/app-mock.css:16,17,18,140,271,286,292,294`: **8** `.appmock-*` selectors with zero JSX matches. Examples: `.demo-sec:185`, `.demo-window:189`, `.demo-thread:202`, `.demo-agent-body:205`, `.appmock-pv-canvas:286/292/294`. | No visual effect — no JSX renders these classes. But ~160 dead rules remain in live sheets owned by other agents. `website/docs/REMOVE-SECTION-V1143.md:30` explicitly says they were **not** edited because the sheets are shared. Dead code, not a broken build. | Owner of `home.css`/`app-mock.css` delete the dead blocks once the hero-panels/site-art waves settle. |
| C2 | INFO | v1142 `.hm-code i` conflict — **FIXED** | `website/app/home.css:121` (`min-width:18px; color:var(--dim)`) + `website/app/hero-panels.css:410` (comment: "`.hm-code i` is owned by `home.css` … Do not re-declare here") | The conflicting `hero-panels.css:245` rule is gone. One owner, one value. v1141 intent (`--dim`) preserved. | none |
| C3 | INFO | Cross-file CSS property conflicts | 8 sheets scanned (`globals`, `home`, `app-mock`, `hero-panels`, `art-motion`, `docs`, `proof.css`, `security-art.css`) — **0 overlaps, 0 conflicting properties** | Parser strips comments + `@keyframes`, flattens `@media`/`@supports`, normalizes whitespace. Strict scoping (`hpx-*`, `hm-*`, `hpx-pv-*`) held. | none |
| C4 | INFO | `@keyframes` name collisions | `website/app/*.css` — **0 duplicates** | none | none |
| C5 | INFO | Import cycles (pre-existing) | 3 SCCs: (1) `src/components/Toasts.tsx → src/i18n.ts → src/store.ts → Toasts.tsx`; (2) `electron/services/mcpRegistryService.ts → electron/agent/mcp.ts → mcpRegistryService.ts`; (3) a **26-node** SCC: `flowsService → notifyService → subagentRunner → proof → mutation → dap → debugTools → isolationService → notebook → lsp → imageGenService → processService → previewService → tools → verification → vibeFlow → prompts → terminalService → libraryService → sessionService → logService → terminalGuard → fsService → checkpointService → engine → flowsService`. | 219 TS/TSX/MJS files scanned. Cycles 1–2 are the same pre-existing debt the v1142 report logged. Cycle 3 is the v1142 `tools.ts` cluster collapsed into one SCC by Tarjan; it **now includes v1143-touched files** (`prompts.ts` 7:58 PM, `engine.ts` 8:04 PM, `proof`). Latent module-init-order risk only — no failing guard. | Track separately; do not block v1143 on pre-existing cycles. |

---

## HONESTY TABLE

Scope: `website/app`, `website/lib`, `website/public`, `src`, `electron`, `shared` (live source). `docs/` hits are historical audit records, not live claims.

| ID | Sev | Claim found | file:line | Reality | Status |
|----|-----|-------------|-----------|---------|--------|
| H1 | **HIGH** | `['20+', 'MCP SERVERS', 'خادم خارجي']` | `website/app/features/page.tsx:278` | MCP servers are **user-configured** (`electron/agent/mcp.ts`); there is no fixed catalog and no "20+" count. `website/app/layout.tsx:95` was corrected to say "add your own MCP servers … you choose which servers to add" — so the site contradicts itself. Rendered live in the STATS band (`features/page.tsx:880`). The literal-string grep misses it because the number and label are separate array cells. v1142 report H3 called this "RESOLVED" — **it is not in this tree**. | **LIVE — fix required** |
| H2 | **HIGH** | `['12', 'SUBAGENTS', 'وكيل فرعي']` | `website/app/features/page.tsx:279` | Roster is **16 agents** (`electron/agent/agents.ts:31`, 16 `id:` entries). `electron/services/billingService.ts:84` already says "All 16 specialist agents" — the features page contradicts the billing page. Same false number v1142 H2 claimed was fixed. | **LIVE — fix required** |
| H3 | **MEDIUM** | `['100%', 'LOCAL', 'محلي']` | `website/app/features/page.tsx:280` | Absolute "100% LOCAL" overstates the product: `website/app/layout.tsx:86-87` truthfully says local-first, files/keys stay local, but **inference needs a provider** and it is "offline-capable rather than offline-only". An absolute violates the founder's no-cliche rule even though the phrase wasn't in the scoped grep list. | **LIVE — judge / soften** |
| H4 | CLEAN | `20+ MCP`, `12 subagents`, `first AI agent`, `first local AI agent`, `no account required`, `unbeatable`, `unlimited forever` | zero literal matches in live source | All 6 scoped phrases: **NONE**. `website/lib/site.ts:5` even carries the explicit note "Honest: one local-first coding agent among many, not 'the' or 'the first'." `website/public/llms.txt:47` says "no account database" — truthful. | none |
| H5 | CLEAN | `All 12 providers` | `website/app/layout.tsx:63`, `website/app/pricing/page.tsx:42`, `electron/services/billingService.ts:60` | Accurate: `electron/agent/providers.ts:522-642` catalogs exactly **12** unique providers (anthropic, deepseek, gemini, meta, minimax, mistral, moonshot, openai, openrouter, qwen, xai, zai). | none |
| H6 | CLEAN | `No account is required to start` | `website/app/docs/page.tsx:104` | Near-match to "no account required" but truthful: `src/components/AuthScreen.tsx:203` has the "No account — proceed straight to the product" escape hatch. Consistent with `src/components/settings/BillingSection.tsx:6` ("honest 'no account' state"). | none |
| H7 | CLEAN | `145 tools`, `Unlimited agent runs on YOUR OWN API keys`, `Unlimited MCP servers` | `website/lib/site.ts:69`, `features/page.tsx:287`, `billingService.ts:59,81` | 145 matches `gen-tool-inventory.mjs` exactly (145). "Unlimited" is qualified by BYO keys / plan limits, not the cliche "unlimited forever". | none |

**Guard blind spot:** `tests-v1142-seo.mjs` H1_FILES includes `app/features/page.tsx` (`:266`) but only checks headings/titles/descriptions/OG — **never the `STATS` band**. No guard in any V1141/V1142/V1143 suite greps `20+`, `SUBAGENTS`, or `MCP SERVERS`. That is why 198/198 checks pass while H1-H3 are live.

---

## GUARD TABLE

| Guard / command | Pass 1 | Final pass | Detail |
|-----------------|--------|-----------|--------|
| `npx tsc --noEmit -p tsconfig.json` | PASS (0) | **PASS (0)** | every error file:line: none |
| `npx tsc -p tsconfig.node.json --noEmit` | PASS (0) | **PASS (0)** | none |
| `cd website && npx tsc --noEmit` | **FAIL — 86 errors** | **PASS (0)** | pass-1 errors all `app/page.tsx` on deleted `DEMO.*` fields; see TREE MOVES. Final: 0. |
| `cd website && npm run build` | **FAIL** | **PASS** | pass-1 `ProductInUse is not defined` at `app/page.tsx:868:8`. Final: 14 static routes; warnings only (Tailwind `content` empty, `postcss.config.js` module type). |
| `node scripts/gen-tool-inventory.mjs` | PASS **145** | **PASS 145** | `{"fs":55,"exec":60,"meta":30}` — must stay 145 ✅ |
| `tests-v1141-hero-visual.mjs` | — | **PASS 19/19** | |
| `tests-v1141-hero-mosaic.mjs` | — | **PASS 18/18** | |
| `tests-v1142-hero-light.mjs` | — | **PASS 15/15** | |
| `tests-v1142-hero-panels.mjs` | — | **PASS 20/20** | |
| `tests-v1142-seo.mjs` | PASS 47/47 (stale `.next`) | **PASS 47/47** | re-run on fresh build; build-artifact SEO verified |
| `tests/v1142-cli.test.mjs` | — | **PASS 6/6** | |
| `tests/v1142-effort.test.mjs` | — | **PASS 12/12** | |
| `tests/v1142-slash-menu.test.mjs` | — | **PASS 12/12** | |
| `tests/v1142-dna-insights.test.mjs` | — | **PASS 5/5** | |
| `tests/v1142-preview-clean.test.mjs` | — | **PASS 10/10** | |
| `tests/v1142-subagent-limit.test.mjs` | — | **PASS 6/6** | |
| `tests/v1142-usage-flows.test.mjs` | — | **PASS 6/6** | |
| `tests/v1143-mention-in-plus.test.mjs` | — | **PASS 12/12** | |
| `tests/v1143-proof-center.test.mjs` | — | **PASS 5/5** | |
| `tests/v1143-skills-auto.test.mjs` | — | **PASS 5/5** | |

**Totals (final):** V1141 = **37/37**. V1142 = **139/139** (7 node suites + 3 root suites). V1143 = **22/22**. All = **198/198**. All compile checks 0 errors. Tool inventory 145.

**No V1141/V1142/V1143 source-level guard detects H1–H3. Green guards ≠ honest copy.**

---

## SCAN DETAIL (final pass)

- **Duplicate i18n keys:** `src/i18n.ts` — **3007** array-literal dictionary keys, **3007 unique, 0 duplicates**. Naive first pass reported one `key` x2; stripped comments resolved it — `src/i18n.ts:1007` is the comment `// Format: 'key': …` and `:3476` is the single real `"key": ["English", "العربية"]` entry. TS compile also 0 errors.
- **Duplicate registry rails:** `src/components/panels/registry.tsx` — `STAGE_RAILS` **15 unique** (`:105-124`, includes `proof` at `:123`), `PANELS` **18 unique** (`:126-154`, `proof` at `:151`), `RAIL_TITLE` **18 unique**. `src/components/Rail.tsx` MORE list **16 unique** (includes `proof`). **0 duplicates.** `wiki` remains a compat alias only (`:139-147`), not a visible rail.
- **CSS collisions:** 8 sheets, enhanced parser (comments + `@keyframes` stripped, `@media`/`@supports` flattened, whitespace normalized) — **0 cross-file overlaps, 0 conflicting properties, 0 duplicate `@keyframes`**. `hero-panels.css:410` explicitly cedes `.hm-code i` to `home.css:121`.
- **Orphan selectors:** P1 removed the WATCH IT WORK section; **152** `.demo-*` selectors in `home.css` + **8** `.appmock-*` in `app-mock.css` have **zero** JSX matches. Dead but invisible. See C1.
- **Conflict markers:** `<<<<<<<` / `>>>>>>>` — **0 hits** across 787 source files (excl. node_modules/.next/dist/build/release).
- **Import cycles:** 3 SCCs over 219 files — see C5. Pre-existing; cycle 3 includes v1143-touched files.
- **New-file wiring:** `website/app/globals.css:1` imports `art-motion.css`; `page.tsx:25/30/35` imports `home.css` → `app-mock.css` → `hero-panels.css` in that order. No orphan new sheets.

---

## RECOMMENDED OWNER ACTIONS (no edits made by this agent)

1. **H1/H2 owner (website features):** `website/app/features/page.tsx:278-279` → `['16', 'AGENTS', 'وكيل فرعي']` and either drop the `20+ MCP SERVERS` tile or replace with a truthful one (e.g. `['BYOK', 'MCP SERVERS', 'خادم خارجي']`). Match `electron/services/billingService.ts:84` and `website/app/layout.tsx:95`.
2. **H3 owner (website features):** `website/app/features/page.tsx:280` → replace `100% LOCAL` with `LOCAL-FIRST` to match `website/app/layout.tsx:86-87`.
3. **Guard owner:** add a V1143 honesty guard that greps the live `STATS` bands on `features/page.tsx` for `20+`, `SUBAGENTS`, `12` next to agent labels, and `100% LOCAL`. The current SEO guard cannot catch these.
4. **CSS owners:** delete the dead `§2 PRODUCT IN USE` / `§6 APP MOCK` blocks in `home.css` and the 8 orphan `.appmock-*` rules in `app-mock.css` after the v1143 waves land.
5. **Info only:** do not block v1143 on C2–C5. The cycles and the dead CSS are pre-existing/shared-sheet debt, not introduced by this fleet.
