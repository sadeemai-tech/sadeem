# INTEGRATION-V1144 — FLEET INTEGRATION + HONESTY AUDIT (DIAGNOSIS + TEST ONLY)

- **Date:** 2026-11-22 (final pass ~10:15 PM)
- **Role:** Integration + honesty auditor. **No source edits made.** The only files written are this report and `tests-v1144-anti-slop.mjs`. Scratch captures live under `D:\ORION\data\cache\tmp\opencode\v1144\`.
- **Method:** 3 full passes while sibling agents rewrote the tree. Every number below is from the **FINAL pass** unless marked otherwise. All four required commands were re-run at the end (one transient failure observed and re-verified green).
- **Guard:** `node tests-v1144-anti-slop.mjs` (add `--no-guards` for scan only, `--json` for machine output).

---

## VERDICT (blunt)

**The anti-slop surface is clean. The honesty surface is NOT.** Zero banned hype words, zero hype `first`, zero mixed-language strings, zero internal leaks, zero duplicate i18n keys, zero conflict markers, zero live CSS collisions. But **4 live false claims survive** — all the same lie: *"20+ MCP servers."* They sit in `components/home/SEOContent.tsx` at **82, 87, 119, 123**, rendered on the homepage. `lib/site.ts:77` and `app/layout.tsx:66,95` tell the truth ("optional MCP servers", "add your own MCP servers"); the SEO copy contradicts them. **The homepage publishes a number that does not exist.**

The three failing guard suites are **stale guards, not broken source**: two enforce v1142-era SEO tags that `docs/SEO-WORDS-V1144.md` deliberately deletes, and one slices the hero using an anchor (`ProductInUse`) deleted in v1143, so it checks an empty string and reports "0-panel mosaic". Green-vs-red here means nothing until those guards are re-anchored.

**Do not sign off on "all guards green" — the copy lie is real and the guards are lying about the hero.**

---

## TREE MOVES OBSERVED (why repeats mattered)

| When | What was seen | Cause | Final |
|------|---------------|-------|-------|
| pass 1 (8:xx PM) | `features/page.tsx:109-110` = "Twenty-plus curated servers…" | Q6 owner mid-rewrite | **FIXED** by pass 2 |
| pass 1→2 | false-claim count **6 → 4** | sibling removed the features-page pair | **4 remain** (all SEOContent) |
| pass 1→3 | literal `first` count **48 → 44 → 42** | ongoing docs/pricing edits | 42 (all literal, benign) |
| pass 1→3 | leak context rows **29 → 26** | DownloadPage / docs wording changed | 26 (all benign) |
| final capture | `npm run build` → **FAIL**: `Unterminated string constant` at `website/app/docs/page.tsx:321` (`'تع showcases crowded Placeholder waiting for XML. Replace me.`) | sibling mid-edit — literally an unfinished string containing `Placeholder` / `Replace me.` | **PASS** on immediate re-run (14 static routes). Transient, not a defect. |
| pass 1→3 | i18n keys **3007 → 3014** | sibling added keys — still 0 duplicates | 3014 keys, 0 dup |

---

## REQUIRED COMMANDS (final)

| Command | Result | Detail |
|---------|--------|--------|
| `npx tsc --noEmit -p tsconfig.json` | **PASS (0)** | |
| `npx tsc -p tsconfig.node.json --noEmit` | **PASS (0)** | |
| `cd website && npx tsc --noEmit` | **PASS (0)** | |
| `cd website && npm run build` | **PASS** | 14 static routes; warnings only (Tailwind `content` empty, `postcss.config.js` module type). One transient mid-edit failure at `docs/page.tsx:321`, re-run green. |

---

## COLLISION + SLOP + LEAK TABLE (blunt, file:line)

| ID | Sev | Class | Finding | file:line | Impact / why it matters | Owner action (not applied) |
|----|-----|-------|---------|-----------|--------------------------|----------------------------|
| **S1** | **HIGH** | SLOP / FALSE | `"20+ servers"` / `"20+ install-ready MCP servers"` / `"أكثر من ٢٠ خادماً"` — 4 live strings | `website/components/home/SEOContent.tsx:82, 87, 119, 123` | Homepage says a fixed 20+ catalog exists. Reality: MCP servers are **user-configured** (`electron/agent/mcp.ts`); `lib/site.ts:77` says "MCP servers", `app/layout.tsx:66,95` say "connect your own / add your own". Contradicts the honest position in 3 other files. Mounted at `app/page.tsx:923`. | Replace with "add your own MCP servers" / "تضيف خوادم MCP الخاصة بك" in all 4 strings. Mirror the truthful FAQ already in `app/layout.tsx:95`. |
| **S2** | **MED** | SLOP (definite article) | `"The local-first AI coding agent"` / `"The local-first coding agent that learns with you."` | `SEOContent.tsx:25`; ` components/download/DownloadPage.tsx:422` | "The" implies *the one / the first*. `lib/site.ts:6` deliberately says **"A local-first…"** with comment `not "the" or "the first"`. Also flagged by hero-honesty advisory (14 WARN). | Use "A local-first…"; drop "learns with you" (unverifiable) per `DOCS-STYLE-V1144.md` Rule 1. |
| **S3** | **INFO** | SLOP (dead code) | `"12 specialist subagents"`, `"gets sharper every run"`, `20+`, `12`, `100%` stat tiles | `components/home/HomeContent.tsx:31-33, 91, 219` | **Orphan file — not rendered.** Dead code, but every banned claim lives here. If any sibling wires `HomeContent` into `page.tsx`, all lies go live instantly. | Delete the orphan file (and `TerminalDemo`, `Reveal`, `ProviderLogo`) or fix the copy before wiring. |
| **L1** | **INFO** | LEAK (allowed) | two 64-hex SHA-256 strings | `website/lib/site.ts:26, 27` | `exeSha256`/`zipSha256` — a real verify-before-run disclosure, explicitly OK. No 64-hex used as decoration anywhere in CSS/art. | none |
| **L2** | **INFO** | LEAK (classified) | `staged` (git), `env`/`headers`/`token`/`debug`, `BUILD` (mode/phase), `publish` ("not published yet" / "published CLI" / "checksums published"), `placeholder` ("never a placeholder button"), `manual` updates | `features/page.tsx:142,150,203,239,240,251,253`; `page.tsx:496`; `pricing/page.tsx:121,259`; `docs/page.tsx:73,94,301`; `download/ChangelogPage.tsx:29,71`; `HomeContent.tsx:70,94,154`; `TerminalDemo.tsx:111,113`; `site.ts:26,27,89` | 26 context rows, **0 hard leaks**. No `0.0.0-stage`, `sha512:`, `SHA256SUMS`, or `npm view` in visible prose. All are technical vocabulary or honest release-status disclosure. | none |
| **C1** | **MED** | COLLISION (orphan sheet) | 22 cross-file property conflicts between two `docs.css` sheets (`.docs-progress`, `.docs-layout`, `.docs-hero`, `.docs-note`, `.docs-tags`…) | `app/docs.css:5-155` **vs** `app/docs/docs.css:7-165` | `app/docs.css` (top level) is **never imported**; only `app/docs/docs.css` is (`app/docs/page.tsx:9`). No runtime effect, but two divergent sheets are a maintenance trap. | Delete `website/app/docs.css` after confirming no external import. |
| **C2** | **MED** | WIRING (orphans) | `HomeContent`, `TerminalDemo`, `Reveal`, `ProviderLogo` never imported | `components/home/{HomeContent,TerminalDemo,Reveal,ProviderLogo}.tsx` | Known dead showcase (v1128 guard F2). Carries the legacy hype/false stats in S3. | Delete or migrate intentionally. |
| **C3** | **HIGH** | COLLISION (stale guard) | hero-honesty H1/H7 report "0-panel mosaic" / "0 dir=ltr hooks" | guard: `tests-v1140-hero-honesty.mjs:52-53`; anchor removed from `app/page.tsx` | Guard slices hero via `page.indexOf('ProductInUse — a faithful')` → **-1** (anchor deleted in v1143) → empty slice. The real page has **6 `.hm-panel`** (`page.tsx:398,602,631,656,671,688`) and **≥3 `dir="ltr"`** (`411,449,484`). Guard is blind, source is fine. | Re-anchor to `function HeroMosaic()` … `export function` (or drop H1/H7). |
| **C4** | **HIGH** | COLLISION (stale guard) | homepage-seo S3 "missing: keywords:"; seo(47) ROOT-1 "missing hreflang" + 3 PAGE-* | guard expectations vs `app/layout.tsx:114-132` | `keywords` and single-URL `hreflang` were **deliberately removed** per `docs/SEO-WORDS-V1144.md` §3.2 / R7 / R9 (Google ignores keywords; 3 tags at one URL are not localisation). Guards enforce v1142 behavior. | Update the two guards to the v1144 SEO contract; do **not** restore the tags. |
| **C5** | **INFO** | TRANSIENT | build broke on an unfinished string with `Placeholder` / `Replace me.` | `app/docs/page.tsx:321` (during pass 3) | Sibling mid-edit. Re-ran immediately → PASS. Also a reminder: a leak token can appear transiently in prose during edits. | none — resolved. |
| **C6** | **INFO** | CLEAN | 3014 i18n keys, 0 duplicates; 0 conflict markers; `home.css`/`hero-panels.css`/`art-motion.css` 0 property collisions, 0 duplicate `@keyframes`; all new sheets wired (`globals.css:1`, `page.tsx:25/30/35`) | `src/i18n.ts`, `website/app/*.css` | no action | none |

---

## HONESTY TABLE

Scope: live website prose (`app/**/*.tsx`, `components/**/*.tsx` except known orphans, `lib/site.ts`). `docs/` and `website/docs/` hits are research/audit records, not live claims.

| ID | Sev | Claim | file:line | Reality | Status |
|----|-----|-------|-----------|---------|--------|
| H1 | **HIGH** | `20+ servers` / `20+ install-ready MCP servers` / `أكثر من ٢٠ خادماً` | `SEOContent.tsx:82,87,119,123` | MCP servers are user-configured; no fixed catalog. `site.ts:77`, `layout.tsx:66,95` say otherwise. | **LIVE — fix** |
| H2 | MED | `The local-first AI coding agent` | `SEOContent.tsx:25` | site.ts:6 uses "A local-first…" precisely to avoid uniqueness. | **LIVE — soften** |
| H3 | MED | `The local-first coding agent that learns with you` | `DownloadPage.tsx:422` | Same definite article + unverifiable "learns with you". Contradicts `site.ts:6`. | **LIVE — soften** |
| H4 | CLEAN | `145 tools`, `16 specialist agents`, `12 providers`, `Free during the public season`, `offline-capable rather than offline-only` | `site.ts:69-103`, `layout.tsx:86-95`, `features/page.tsx:275-280` | STATS band is now `MCP / BRING YOUR SERVERS` + `16 / SPECIALIST AGENTS` + `LOCAL / FIRST, BYOK` — v1143 H1/H2 **fixed**. Counts match code. | none |
| H5 | CLEAN | 0 hype words (`unbeatable`, `seamless`, `revolutionary`, `supercharge`, `unlock`, `powerful`, `game-changing`) and 0 Arabic hype (`في المقدمة` as hype, `الأفضل`, `لا مثيل له`, `ثورة`, `قوي`, `سلس`, `إطلاق العنان`) | all scanned files | 42 `first` hits are all literal (`local-first`, `privacy-first`, `first run/task/file/tier`, `newest-first`, `the first time`). 1 Arabic `الأول/الأولى` hit is ordinal (`features/page.tsx:916`). The guard also classifies "في المقدمة" as literal when it means "foreground" — 0 such hits in the final tree. | none |

---

## GUARD TABLE (final pass)

| Guard | Result | Detail |
|-------|--------|--------|
| `tests-v1140-hero-honesty.mjs` | **FAIL** | 11 PASS / 3 FAIL / 14 WARN — H1, H7 stale anchor (C3); H14 strict wording on `site.ts:79`. Warnings are honest advisories (H2/H3 + research docs). |
| `website/tests-homepage-seo.mjs` | **FAIL** | 7 PASS / 1 FAIL / 1 WARN — S3 expects `keywords:` deliberately removed (C4). |
| `tests-v1142-seo.mjs` | **FAIL** | 43 PASS / 4 FAIL — ROOT-1 + PAGE-home/changelog/auth expect hreflang deliberately removed (C4). |
| `tests-v1141-hero-visual.mjs` | **PASS** | |
| `tests-v1141-hero-mosaic.mjs` | **PASS** | 18/18 |
| `tests-v1142-hero-light.mjs` | **PASS** | |
| `tests-v1142-hero-panels.mjs` | **PASS** | 20/20 |
| `tests/v1142-cli.test.mjs` | **PASS** | 6/6 |
| `tests/v1142-dna-insights.test.mjs` | **PASS** | 5/5 |
| `tests/v1142-effort.test.mjs` | **PASS** | 12/12 |
| `tests/v1142-preview-clean.test.mjs` | **PASS** | 10/10 |
| `tests/v1142-slash-menu.test.mjs` | **PASS** | 12/12 |
| `tests/v1142-subagent-limit.test.mjs` | **PASS** | 6/6 |
| `tests/v1142-usage-flows.test.mjs` | **PASS** | 6/6 |
| `tests/v1143-mention-in-plus.test.mjs` | **PASS** | 12/12 |
| `tests/v1143-proof-center.test.mjs` | **PASS** | 5/5 |
| `tests/v1143-skills-auto.test.mjs` | **PASS** | 5/5 |

**Totals: 14 pass / 3 fail.** All 3 failures are stale-guard contract mismatches (C3/C4), not regressions. `tests-v1144-anti-slop.mjs` exits 1 on the 4 live false claims (S1).

---

## SCAN DETAIL (final pass)

- **Slop:** 0 EN hard hype, 0 hype `first` (42 literal), 0 AR hype (1 ordinal `الأول`).
- **Leaks:** 0 hard. 26 context rows, all `OK-*` (checksums, git terms, technical tokens, honest status). No `0.0.0-stage`, `sha512:`, `SHA256SUMS`, `npm view`, or decorative 64-hex.
- **Mixed language:** 0. All bilingual pairs are separate `tx(en, ar)` args; brand/tool tokens (SADEEM, MCP, BYOK, GitHub, OpenAI…) stripped before detection.
- **i18n:** 3014 keys unique; 0 conflict markers across all source.
- **CSS:** 13 sheets parsed with at-rule-scope tracking; 0 cross-file collisions on wired sheets, 0 duplicate `@keyframes`. 22 conflicts exist **only** between the orphan `app/docs.css` and the wired `app/docs/docs.css` (C1).
- **Wiring:** `art-motion.css` ← `globals.css:1`; `home.css`/`app-mock.css`/`hero-panels.css` ← `page.tsx:25/30/35`; `SEOContent` imported `page.tsx:24`, mounted `page.tsx:923`. Orphans: C2 + C1.

---

## RECOMMENDED OWNER ACTIONS (no edits made by this agent)

1. **SEO copy owner (Q5/Q6):** fix the 4 `20+` strings at `SEOContent.tsx:82,87,119,123` → "add your own MCP servers" / "تضيف خوادم MCP الخاصة بك". This is the only live lie.
2. **Copy owner:** `SEOContent.tsx:25` and `DownloadPage.tsx:422` → "A local-first…", drop "learns with you" (see `DOCS-STYLE-V1144.md` Rule 1).
3. **Guard owner:** re-anchor `tests-v1140-hero-honesty.mjs` (C3) and retire the `keywords`/`hreflang` assertions in `homepage-seo`/`tests-v1142-seo` (C4). Do not restore the removed tags.
4. **Debt owners:** delete orphan `app/docs.css` (C1) and the 4 orphan homepage components (C2) once the waves settle.
5. **Info only:** builds are green, C5 was transient, and the C6/C1-C3 CSS/art collision checks are clean on all wired sheets. Do not block v1144 on anything except H1/H2/H3.

---

## LIMITATIONS

Source-level diagnosis only. This audit cannot see pixels, rendered contrast, or whether copy reads naturally to a human; it reports exact strings and file:line. It does not edit source. Guard results are snapshots of a moving tree — re-run `node tests-v1144-anti-slop.mjs` after each sibling merge.
