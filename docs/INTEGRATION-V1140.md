# INTEGRATION AUDIT — v11.40 (DIAGNOSIS ONLY)

Auditor: integration subagent. Mode: read-only. No source files were edited.
Method: 4 full check passes because sibling agents were writing files **during** the audit.
Findings below are a snapshot; the tree is a moving target — see "Stability" at the end.

---

## 1. BUILD / TYPECHECK RESULTS

| Pass | Command | Result |
|---|---|---|
| T0 (start) | `npx tsc --noEmit -p tsconfig.json` | PASS |
| T0 | `npx tsc -p tsconfig.node.json --noEmit` | PASS |
| T0 | `cd website && npx tsc --noEmit` | PASS |
| T0 | `cd website && npm run build` | PASS — 14 static routes. Warnings only (see C7). |
| T1 | `cd website && npx tsc --noEmit` | **FAIL — 12 errors**, `app/page.tsx`: `PALE` @ 558,573,575,577,581,590,597; `RULER` @ 562 (+TS7006 `r`); `TRACES` @ 607 (+TS7006 `t`); `InkFlow` @ 1017. |
| T2 | `npx tsc --noEmit -p tsconfig.json` | **FAIL** — `SignaturePanel.tsx(250,7)` TS2322 `'"autopsy"' not assignable to type 'Tab'`; `(333,8)` TS2367 no overlap. |
| T2 | `cd website && npx tsc --noEmit` | FAIL — `InkFlow` @ 1220. |
| T3 (final) | `npx tsc --noEmit -p tsconfig.json` | **FAIL — 1 error remains**: `src/components/SignaturePanel.tsx(333,8): TS2367 — comparison 'Tab' vs '"autopsy"' has no overlap`. |
| T3 | `npx tsc -p tsconfig.node.json --noEmit` | PASS |
| T3 | `cd website && npx tsc --noEmit` | PASS (InkFlow removed; replaced by locally-defined `AppMockSilk` @ `page.tsx:813`). |
| T3 | `cd website && npm run build` | Blocked: `⨯ Another next build process is already running` (a sibling owns the `.next` lock). Last verified successful build is T0. |

**Verdict: NOT shippable as-is.** Root `tsc` is red from `SignaturePanel.tsx`. The website is green again, but only after three mid-flight rewrites of `page.tsx`.

---

## 2. COLLISION TABLE

| # | Sev | Collision | Evidence (file:line) | Impact / fix direction |
|---|---|---|---|---|
| C1 | **CRITICAL** | Two competing cursor/click motion systems for the SAME elements. Inline `<style>{APP_MOCK_MOTION}</style>` (`page.tsx:~235–333`, injected `~688`) defines `appmock-mouse-glide` 9.2s / `appmock-ripple` / `appmock-ring`; `home.css` defines `appmock-cursor-path` 8.6s / `appmock-click-pulse`. Selectors have identical specificity, e.g. `.appmock-stage[data-in] .appmock-window .appmock-cursor` (`home.css:597` vs inline `page.tsx:260`) and the `::after` pair (`home.css:598` vs inline `:266`). Inline `<style>` in body wins → home.css path is dead. | `home.css:530–598`, `home.css:541` vs `:658`, `page.tsx:229–332`, `page.tsx:688` | Contradicts the explicit contract in `page.tsx:218–228` ("exactly ONE authoritative path", "keyframes defined ONCE in home.css §6") and `home.css:587–592` ("selectors below outrank that scaffold") — both comments are false. Pick one owner; delete the other's keyframes + rules. Also two cursor sizes: 20×24 (`home.css:541`) vs 18×22 (`home.css:658`, inline `:235`). |
| C2 | **HIGH** | `SignaturePanel` tab union/usage mismatch. `type Tab = 'trajectory' \| 'insights' \| 'compass'` but a new `autopsy` tab was added to the list and render branch. `insights` is in the union but appears unused. | `src/components/SignaturePanel.tsx:34`, `:250`, `:333` | Root build red (TS2367 at `:333`). Add `'autopsy'` to `Tab` (and drop `insights` if truly dead). |
| C3 | **HIGH** | `page.tsx` in-flight rewrite churn: undefined `PALE`/`RULER`/`TRACES` (T1), then missing `InkFlow` import (T1–T2), then whole band swapped to `AppMockSilk`. File grew 956 → 1230+ lines during the audit. Header comment (`:3–12`) still claims lucide icons are used and glyphs are "copied verbatim into GLYPHS below" — markup actually uses hand-coded `navPaths`/`utilPaths` and there is no `GLYPHS` block. | `page.tsx:3–12`, `:654–672`, `:813`, `:1221–1226` | Stale comments + duplicated drawing systems. Re-read the whole file after agents stop; verify no remaining orphan references. |
| C4 | MEDIUM | Duplicate/conflicting rules **inside `home.css`**: `.appmock-send` defined at `:491` and again at `:660`; `.appmock-send svg` = 15px @`:489`, 16px @`:493`, 15px @`:655`; `.appmock-cursor>svg` 20×24 @`:541` vs 18×22 @`:658`; `.appmock-mic/.orb/.send svg` repeated @`:489` and `:655`. | `home.css:489–493`, `:541`, `:655–660` | Later rule wins silently; earlier ones are dead. Cosmetic today, but it means "one source of truth" claims are unreliable. |
| C5 | LOW | CSS custom-property namespace collision: `--am-ink` = `#0c1103` (near-black) on `:root` in `art-motion.css` vs `#E9EEF6` (near-white) on `.appmock-stage` in `home.css`. | `art-motion.css:25`, `home.css:303` | Scoping currently saves the app mock, but any `.am-*` art outside `.appmock-stage` that reads `var(--am-ink)` gets near-black ink — illegible in the dark theme. Rename the art-motion token. |
| C6 | LOW | Three motion systems on one page with different cadences: `art-motion` 2.8s (`art-motion.css:27`), home app-mock pulse 4.8s (`home.css:49,65`), inline cursor 9.2s (`page.tsx:261`). Namespaces don't clash (`am-*` vs `appmock-*`), so no hard break — but no shared clock. | as listed | Visual coherence risk only. |
| C7 | LOW | Build warning: Tailwind `content` empty. Config lives only at repo root (`tailwind.config.js:3`, `./src/**`), so the `website/` build resolves no config. Also `postcss.config.js` module-type warning. | build log T0; `tailwind.config.js:1–3` | If website JSX uses Tailwind utilities they will not be emitted. Website CSS is hand-authored, so currently non-blocking. |
| C8 | INFO | **Clean scans:** no duplicate i18n keys (`src/i18n.ts`: 2,980 keys, 0 duplicates); no duplicate `default` exports in any `page.tsx` (all have exactly one; changelog/download additionally export `metadata`, which is correct); no conflict markers (`<<<<<<<`/`=======`/`>>>>>>>`) in `website/app`, `src`, `docs`, or `shared`. | scan output | — |

`app-mock.css` is well-behaved: every selector is `.appmock-stage`-scoped, it owns no keyframes, and it overrides `home.css` intentionally by specificity (`:63–66`, `:78–126`). No collision there.

---

## 3. HONESTY TABLE

Requested grep: `first local|the first AI|unbeatable|unlimited forever|subscription|buy now|credits` across `website/app`, `website/lib`, `src/components`.

| Term | Hits | Verdict |
|---|---|---|
| `first local` / `the first AI` / `unbeatable` / `unlimited forever` / `buy now` | **0** | No leftover superlative/scarcity claims. X1's cleanup held for these. |
| `subscription` | ~28 | All **negations** or policy comments: `site.ts:39,64,74`; `layout.tsx:59`; `page.tsx:361`; `pricing/page.tsx:31,45,54,62,87,117,129,136,141,217,223,255,327,339,404`; `CapabilityGuide.tsx:54,289,402`; `Onboarding.tsx:155,167`; `WhatsNew.tsx:9,38`; `billingShared.tsx:2–4`; `PlansScreen.tsx:4`; `BillingSection.tsx:15`. Honest. |
| `credits` | ~15 | Negations in pricing copy + **legitimate** provider-error handling: `ErrorNotice.tsx:36,63,193,194` matches "Insufficient credits (402)" from the provider. Not a marketing claim. |
| `free forever` (broader scan) | 5 | `pricing/page.tsx:32,129,217,404`; `site.ts:39` — all scoped to "**BYOK** is free forever", which is true (no billing path). Absolute phrasing; if X1 wants zero absolutes, rewrite as "BYOK stays $0". |

### Flagged leftovers / contradictions (higher priority than the grep terms)

| # | Sev | Issue | Evidence |
|---|---|---|---|
| H1 | **CRITICAL** | **Marketing says "no account required to start"; the app hard-blocks on account creation.** Website: "no telemetry, **no account required to start** — the whole agent runs on your machine." App: after boot it renders `<AuthGate />` full-screen before any workspace value is shown. Even the local-only path is an account. This is a false claim on the first screen of the website vs the first screen of the app. | `website/app/page.tsx:345` vs `src/App.tsx:346–352,361,406–435` |
| H2 | MEDIUM | Numeric SEO claim "20+ MCP servers, 12 subagents" is stated as fact; home page elsewhere claims "145 real tools / 12 providers". Verify counts before launch or soften. | `website/lib/site.ts:69`; `website/app/page.tsx:375,360` |
| H3 | INFO | `SITE.version` still `11.12.0` while all v11.40 docs/copy render `v{SITE.version}` in the hero engraving. Not false, but the site will display an old version next to v11.40 messaging. | `website/lib/site.ts:4`; `website/app/page.tsx:641` |
| H4 | INFO | Honest gating is correctly implemented: `freeSeason = NEXT_PUBLIC_FREE_SEASON !== 'false'` and empty `checkoutUrl` hides the payment button. "Checkout stays closed" copy is accurate. | `website/lib/site.ts:34–38`, `pricing/page.tsx:217,255` |

---

## 4. FIRST-SCREEN REVIEW (READ-ONLY, 5 HIGH-IMPACT SUGGESTIONS)

Scope read: `src/App.tsx`, `src/components/Welcome.tsx`, `src/components/Home.tsx`, `src/components/ChatPanel.tsx` (empty console). The founder wants the first screen "stunning & professional".

1. **Remove the login wall from the first screen.** `src/App.tsx:346–352` (boot spinner) → `:361` renders `<AuthGate />` → `:406–435` full-screen sign-in. A brand-new user's first substantive view is a form, not the product — and it directly contradicts the website's "no account required to start" (`page.tsx:345`). Defer account creation until after the first project is opened (or make local-device sign-in a one-click, non-blocking step) so `Welcome` is genuinely screen #1. **Biggest single win.**

2. **Welcome has three competing primary actions and no hero art.** `Welcome.tsx:221–289` puts three starter cards + two setup cards above the recent-projects list (`:294–366`), then a separate "Enter SADEEM" CTA at `:368–379`; `Home.tsx:205–221` adds "New Session"/"Open Project" once a workspace exists. Collapse to **one** dominant CTA plus one quiet secondary; move "Connect an AI model"/"Security level" below the fold. Today the eye has no single place to land.

3. **Scale the illustration into the masthead.** `Welcome.tsx:177–216` is a narrow (`max-w-[680px]`), text-centred column with a 52px logo and `max-w-[22ch]` title; the only image is a 168×116 `<img>` buried in the empty-recent state at `:307–314`. Give the first screen one memorable, hand-authored visual (the same engraved hairline language used on the website) at hero scale. Cards-all-the-way-down is professional but not "stunning".

4. **The chat empty console is a wall of ~9 links.** `ChatPanel.tsx:1785–1812`: logo + title + sub, `DerivedTasks` 3–4 rows (`:229–245`), 4 `STARTERS` rows (`:1793–1806`), a "New session" button, and a hint. The "fills the composer — review, then send" hint is repeated **three times** (`:235`, `:1798`, `:1811`). Group into two tiers with one prominent prompt field and one hint; keep derived tasks (they're genuinely useful and context-aware) but demote the generic starters.

5. **When a workspace is already set, Home opens as an empty dashboard.** `Home.tsx:188–279` leads with a greeting and six dense metric tiles; on a fresh install nearly all read `0/0`, "no runs yet", "—". Lead with the single next action (open project / new session) and only show metric tiles once they carry real data. Minor: the greeting is time-derived via `new Date().getHours()` (`:168–173`) — fine in Electron, but it makes the first screen nondeterministic for any snapshot/SSR test.

---

## 5. STABILITY WARNING

The audit itself observed the tree changing continuously:

- `website/app/page.tsx` grew from 956 → 1230+ lines; the `Home` export moved `:949 → :958 → :969`; `InkFlow` disappeared and `AppMockSilk` appeared; the undefined-constant errors vanished on their own.
- Root `tsc` went PASS → 2 errors → 1 error between passes; `SignaturePanel.tsx:250` was fixed while `:333` remained.
- The final website build could not be rerun because a sibling already held the Next build lock.

**Recommendation to parent:** freeze writes, then run the full four-command battery once more before merge. Every "PASS" above is time-stamped and may already be stale. Do not merge with `SignaturePanel.tsx:333` red.
