# INTEGRATION-V1142 — FLEET INTEGRATION AUDIT (DIAGNOSIS ONLY)

- **Date:** 2026-11-22
- **Role:** Fleet integration auditor. **No source edits made.** (Only temp analysis scripts under `D:\ORION\data\cache\tmp\opencode\`.)
- **Method:** two full passes of every required command, plus source scans. The second pass was necessary: **the tree moved mid-audit** (see "TREE MOVES" below). All status values below are from the **final** pass unless explicitly marked "pass 1".

---

## VERDICT (blunt)

Builds are green and all 8 v1141/v1142 guards now pass. Two real integration/honesty defects survive, both reachable from live user-facing copy or CSS:

1. **`website/app/layout.tsx:95` still publishes the false "20+ install-ready MCP servers" claim** — the v1140 honesty report claimed this was fixed; it was not.
2. **`website/app/hero-panels.css:245` silently overrides `website/app/home.css:121`** — two sibling-owned sheets fight over `.hm-code i`; the later import wins and drops label contrast to `--faint`.

Everything else is cosmetic or pre-existing debt. No broken build, no conflict markers, no duplicate exports, no duplicate i18n keys, no orphan CSS.

---

## COLLISION TABLE

| ID | Sev | Collision | file:line | Impact / why it matters | Fix (not applied) |
|----|-----|-----------|-----------|--------------------------|-------------------|
| C1 | **MEDIUM** | `.hm-code i` — two sibling-owned sheets set the same properties to different values | `website/app/home.css:121` (`min-width:18px; color:var(--dim)`) vs `website/app/hero-panels.css:245` (`min-width:16px; color:var(--faint)`) | `page.tsx:34` imports `hero-panels.css` **after** `home.css` (`:25`), so hero-panels wins. The v1141 guard explicitly asserts "tabular mono labels use adaptive `--dim`" — that intent is silently changed to low-contrast `--faint`. Two agents "won" different halves of one element. | One owner. Align both to the same values or delete the `home.css` rule. |
| C2 | LOW | `.hm-app-files>span:not(:first-child)` split across sheets | `website/app/home.css:114` (`white-space:nowrap; overflow:hidden; text-overflow:ellipsis`) vs `website/app/hero-panels.css:153` (`display:flex; align-items:center; gap:3px; font-size:7px`) | Complementary properties, no hard override — but `text-overflow:ellipsis` on a `display:flex` span will not clip the way the home.css author intended. Visual only. | Consolidate into one rule; verify clipping in the Desktop panel. |
| C3 | INFO | `effort.css` overrides `chat-final.css` by design | `src/components/effort.css:18,96,110,126,151,152,165,168,199,209,221,229` vs `src/components/chat-final.css` (multiple `.cf-effort-*`) | **Not a bug.** `EffortControl.tsx:38-39` imports `chat-final.css` then `effort.css`; final bundle confirms override appears after base (dist CSS offsets 691675 > 515207). Keep this order. | none |
| C4 | INFO | `signature-art.css` imported by two panels | `src/components/SignaturePanel.tsx:30`, `src/components/panels/DnaPanel.tsx:34` | ES module dedupe — sheet applied once. No collision. | none |
| C5 | INFO | Import cycles (pre-existing) | `src/i18n.ts:3` ↔ `src/store.ts` ↔ `src/components/Toasts.tsx` (3 cycles); `electron/agent/mcp.ts` ↔ `electron/services/mcpRegistryService.ts`; `electron/agent/tools.ts` ↔ `debugTools.ts` / `lsp.ts` / `notebook.ts` (4 cycles) | Verified with `madge`: 3 in `src`, 4 in `electron/shared`. None of the cycled files were touched by v1142 sibling waves — **pre-existing debt**, not introduced here. Latent module-init-order risk only. | Track separately; don't block v1142 on it. |
| C6 | INFO | Wiki rail removal is consistent | `src/components/panels/registry.tsx:109-116,131-139`; `src/components/Rail.tsx:71-72` | `wiki` removed from `STAGE_RAILS` and from visible nav; retained as a compat alias in `PANELS` + `RAIL_TITLE` for deep links. Registry covers all new panels: `UsagePanel`, `DnaPanel`, `FlowsPanel`, `SkillsPanel`, `SignaturePanel`. | none |
| C7 | INFO | No orphans / no duplicates | all source | All new CSS sheets are imported somewhere (`art.css` via `src/styles.css:3`, `chat-art.css` via `console.css:2`, `flows-art.css` via `flows.css:18`, `hero-panels.css` via `page.tsx:34`, `effort.css` via `EffortControl.tsx:39`, etc.). No duplicate export names in 257 files. No duplicate i18n keys in 2399. No conflict markers. No duplicate `@keyframes` names. | none |

---

## HONESTY TABLE

Scope: `website/app`, `website/lib`, `website/public`, `src`, `electron`, `shared` (live product source). `docs/` hits are historical audit records, not live claims.

| ID | Sev | Claim found | file:line | Reality | Status |
|----|-----|-------------|-----------|---------|--------|
| H1 | **HIGH** | `SADEEM ships a curated catalog of 20+ install-ready MCP servers — GitHub, Figma, Supabase, Playwright, Notion and more.` | `website/app/layout.tsx:95` | MCP servers are **user-configured** (`electron/agent/mcp.ts`); there is no fixed catalog and no "20+" count. This is FAQ JSON-LD, so it is machine-readable marketing. `docs/HERO-HONESTY-V1140.md:68,129` said this was fixed — **it was not**. The v1142 SEO guard only checks titles/descriptions/OG alt (`tests-v1142-seo.mjs` SEO-5), so FAQ body text is a guard blind spot. | **LIVE — fix required** |
| H2 | **MEDIUM** | `' All 12 subagents'` in the Pro plan feature list | `electron/services/billingService.ts:84` | Roster is **16 agents** (`electron/agent/agents.ts:2,31`). Same numeric error the v1140 report claimed to have removed. | **LIVE — fix required** |
| H3 | RESOLVED | `['20+', 'MCP SERVERS', ...]` and `['12', 'SUBAGENTS', ...]` stat tiles | `website/app/features/page.tsx:278-279` | Present on pass 1; **gone on final pass** — sibling corrected the stat strip mid-audit. | fixed in tree |
| H4 | CLEAN | `first local AI agent` / `no account required` / `no account required to start` | none in live source | Zero matches. `website/public/llms.txt:47` ("no account database") and `src/components/settings/BillingSection.tsx:6` ("honest 'no account' state") are truthful descriptions, not claims. | none |
| H5 | CLEAN | literal `12 subagents` / `20+ MCP` elsewhere | `src/store.ts:2750`, `src/lib/api.ts:708` | Both are comments reading `v11.12 Subagent dashboard` — version label, not a count. | none |

---

## GUARD TABLE

| Guard / command | Pass 1 | Final pass | Detail |
|-----------------|--------|-----------|--------|
| `npx tsc --noEmit -p tsconfig.json` | PASS (0 errors) | **PASS (0 errors)** | every error with file:line: none |
| `npx tsc -p tsconfig.node.json --noEmit` | PASS (0) | **PASS (0)** | none |
| `cd website && npx tsc --noEmit` | PASS (0) | **PASS (0)** | none |
| `cd website && npm run build` | PASS | **PASS** | 14 static routes; warnings only: Tailwind `content` empty, `postcss.config.js` module-type |
| `node scripts/gen-tool-inventory.mjs` | PASS **145** | **PASS 145** | `{"fs":55,"exec":60,"meta":30}` — must stay 145 ✅ |
| `tests-v1141-hero-visual.mjs` | PASS 19/19 | **PASS 19/19** | |
| `tests-v1141-hero-mosaic.mjs` | PASS 18/18 | **PASS 18/18** | |
| `tests-v1142-hero-light.mjs` | PASS 15/15 | **PASS 15/15** | |
| `tests-v1142-hero-panels.mjs` | PASS 20/20 | **PASS 20/20** | |
| `tests-v1142-seo.mjs` | PASS 47/47 | **PASS 47/47** | build-artifact SEO verified |
| `tests/v1142-effort.test.mjs` | **FAIL 11/12** | **PASS 12/12** | Pass-1 failure was subtest `4b` at `tests/v1142-effort.test.mjs:244`: naive `/gradient\|@keyframes/` regex matched the *comment* at `src/components/effort.css:6` ("no gradient, no keyframes"). **False positive**, not a CSS violation. Sibling fixed the test at `:244-245` by stripping `/* … */` before asserting. |
| `tests/v1142-cli.test.mjs` | PASS 4/4 | **PASS 6/6** | 2 tests added mid-audit (tree move) |
| `tests/v1142-slash-menu.test.mjs` | PASS 12/12 | **PASS 12/12** | |

**Totals (final):** v1141 = 37/37 checks. v1142 = 112/112 checks across 6 suites. All compile checks 0 errors.

---

## SCAN DETAIL (final pass)

- **Duplicate i18n keys:** `src/i18n.ts` — 2399 quoted dictionary keys, **0 duplicates**; TS also enforces this at compile (0 errors). `website/lib/i18n.tsx` uses inline `tx(en, ar)`, no key map.
- **Duplicate exports:** scripted scan of 257 TS/TSX files under `src`, `electron`, `shared`, `website/{app,lib,components}` — **0 files** with a repeated export name. `website/app/page.tsx` has exactly one export (`export default function Home()` at `:1418`).
- **CSS collisions:** improved parser (comments + keyframes stripped, accurate line numbers) over 12 sheets found **7 cross-file selector overlaps**, of which **1 is a real property conflict (C1)**; the rest are complementary props or artifacts of keyframe percentage blocks. `@keyframes` names are unique across all sheets.
- **Import cycles:** `madge --circular` → 3 in `src` (`i18n.ts > store.ts > Toasts.tsx`, `store.ts > Toasts.tsx`, `i18n.ts > store.ts`), 4 in `electron/shared` (`mcp.ts > mcpRegistryService.ts`, and `tools.ts` ↔ `debugTools.ts`/`lsp.ts`/`notebook.ts`). All pre-existing.
- **Conflict markers:** `<<<<<<<` / `>>>>>>>` — **0** in all source. (`=======` hits were license-file separators in `node_modules` / `release`.)
- **New-file wiring:** every recently-added CSS sheet is imported; every new panel is in `PANELS` + `STAGE_RAILS`; `website/app/(sitemaps)/seo.tsx` (route group, emits no route) is imported by `website/app/auth/layout.tsx:3` and `website/app/changelog/layout.tsx:3`.

---

## TREE MOVES OBSERVED (why the 2nd pass mattered)

1. `tests/v1142-effort.test.mjs:244-245` — test rewritten to strip CSS comments; the pass-1 false-positive failure disappeared.
2. `tests/v1142-cli.test.mjs` — test count went 4 → 6.
3. `website/app/features/page.tsx:278-279` — false "20+ MCP SERVERS" / "12 SUBAGENTS" stat tiles corrected.
4. `electron/agent/cli.ts` mtime advanced from 18:39 → later in the run; CLI tests continued to pass.

Because of these moves, **the two surviving honesty defects (H1, H2) are the current state as of the final pass**, not the pass-1 state.

---

## RECOMMENDED OWNER ACTIONS (no edits made by this agent)

1. **H1 owner (SEO/layout):** rewrite `website/app/layout.tsx:95` — drop "curated catalog of 20+ install-ready MCP servers" and the named-server list; say MCP servers come from user settings. Consider widening `tests-v1142-seo.mjs` to scan FAQ JSON-LD body text, not only title/description/OG alt.
2. **H2 owner (billing):** `electron/services/billingService.ts:84` → "All 16 subagents" (match `electron/agent/agents.ts:2,31`).
3. **C1 owner (website hero):** reconcile `home.css:121` and `hero-panels.css:245` to one value pair. Decide whether line numbers should be `--dim` (v1141 intent) or `--faint` (new panel aesthetic), then make both agree.
4. **C2 owner:** verify `.hm-app-files` ellipsis still clips after `display:flex` is applied by `hero-panels.css:153`.

Everything else is informational — do not block the v1142 merge on C3–C7.
