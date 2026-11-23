# SITE-WOW V1128 — Guard / تقرير الحارس

> Scope: `website/` source only. No app (Electron) source was touched.
> النطاق: مصدر الموقع فقط. لم يُلمس مصدر تطبيق سطح المكتب.

---

## الحكم بصراحة — Blunt verdict (AR then EN)

**عربي:** المصدر ليس «مزيداً من CSS» فقط. أضيفت أربعة مكوّنات SVG تفاعلية حقيقية
(`OrbitConstellation`, `InkFlow`, `PrecisionGrid`, `InkReveal`) تعمل بـ IntersectionObserver
وصفر `Math.random`/`Date` في وقت الرسم، مع قسم «شاهده يعمل» يحوي محادثة وتفكيراً
وأدوات وإثباتاً بالعربية والإنجليزية. لكن **الصورة الحقيقية لم تُراجَع**، والموقع
المنشور ما زال يقدّم بناءً قديماً بلا أي من هذه العلامات. لا يمكنني أن أدّعي أن
الموقع «أكثر روعة» بالبكسل — فقط أن الكود أشدّ حياةً. الحكم: **مادة حقيقية، إثبات بصري
معلّق، والموقع الحيّ لم يتغيّر بعد.**

**EN:** This is **not** "just more CSS." Four real interactive SVG art components
were added, driven by IntersectionObserver, with no render-time `Date`/`Math.random`,
plus a genuine "watch it work" section with chat / thinking / tool cards / proof,
all bilingual. But **source is not pixels**: the live deployment still serves an
older build with none of the new markers. I cannot honestly call the site "more
breathtaking" in a browser yet — I can only say the source is materially more alive.
**Verdict: real substance landed; pixel proof pending; live site unchanged.**

---

## 1. Source verification / تحقق المصدر

| Check | Result | Exact evidence |
|---|---|---|
| New keyframes exist | PASS | `app/globals.css:368-411` — `ink-draw`, `slow-orbit`, `float-settle`, `hairline-scan`, `glyph-stagger`, `section-bloom`, `aurora-drift`; `components/visuals/visuals.css:27,48` — `oc-pulse`, `if-travel`; `app/home.css:291-293` (`demo-orbit-spin`, `demo-ring`, `demo-core`); `app/features/features.css:61-63,112,130`. **24 keyframes total.** |
| Utility classes exist | PASS | `app/globals.css:414-441` — `.anim-ink-draw … .anim-aurora`; `components/visuals/visuals.css:18,37,60,81,96` — `.oc/.if/.pg/.ir-frame/.art-cursor__ring` |
| Reduced-motion guards cover them | PASS (28 class guards) | `app/globals.css:444-455`; `components/visuals/visuals.css:118-136`; `app/home.css:110-114,198-208,358-372`; `app/features/features.css:346-354` |
| No hydration-unsafe `Date`/`Math.random` at render | PASS | 34 TS/TSX files scanned, 0 render-time hits. `app/sitemap.ts:24 new Date()` is a server metadata route (exempt). `app/auth/page.tsx:66 Date.now()` lives in `saveAccount()`, called only from the `submit` handler at `app/auth/page.tsx:289` — never during render. |
| Deterministic demo first paint | PASS | `app/page.tsx:134-168` `useTypewriter`/`useWordReveal` start from `''`/`0`, `inView=false` on server and client. |
| "App in use" section with chat / thinking / tool | PASS | `app/page.tsx:581` `<section id="watch">`; chat `app/page.tsx:608`; thinking `app/page.tsx:629` (orbit SVG `:630-636`); tool cards `app/page.tsx:651` (`read_file`) + `app/page.tsx:661` (`run_command`); reasoning `:642`; PROOF `:694`; honest caption `:711` — "not a screen recording / ليس تسجيل شاشة". |
| New art actually mounted (not dead) | PASS | `app/page.tsx:9` imports; `app/page.tsx:776` `<OrbitConstellation>`, `:788` `<InkFlow>`, `:810` `<PrecisionGrid>`; `app/features/page.tsx:19` imports `InkReveal`, rendered at `:327,638,760,790,823,834,863,885`; `components/visuals/index.ts:10-12` exports. |
| Bilingual EN/AR | PASS | `lib/i18n.tsx:11` `ar` default, `:20-24` dir/lang sync; `app/page.tsx` 77 `tx()` pairs + 90 Arabic lines; `app/features/page.tsx` 104 Arabic lines. |

**Reusable guard:** `website/tests-v1128-site-guard.mjs` — re-runnable, source-only,
prints `[+]/[X]/[!]` with file:line and exits 1 on any hard failure.

### Gaps reported to parent / الفجوات المبلّغة

1. **GAP-1 (real a11y leak) — `app/features/features.css:129`:** the hover pulse on
   `.fp-think-core` is gated only by `html:not(.reduce-motion)`. Nothing in the
   codebase adds `.reduce-motion` from the OS preference (the CSS uses the media
   query everywhere else). A visitor with `prefers-reduced-motion: reduce` still
   gets this hover animation. Fix: add `.fp-think-core` to the
   `@media (prefers-reduced-motion: reduce)` block at `features.css:346`.
2. **GAP-2 (dead code) — `components/home/HomeContent.tsx:457` + `components/home/TerminalDemo.tsx`:**
   a second, full "app in use" showcase that is **never imported** by any page.
   The shipped showcase is the inline `#watch` in `app/page.tsx:581`. Delete the
   orphan or wire it — two sources will drift.
3. **GAP-3 (cosmetic) — `app/page.tsx:654` and `:664`:** `tx('◫','◫')`, `tx('›_','›_')`
   are no-op translations (glyphs). Harmless, but they inflate the "bilingual" count.
4. **GAP-4 (infra) — `lib/site.ts:8`:** canonical `siteUrl = https://sadeem-ai.com`
   does **not resolve** (`DNS: remote name could not be resolved`). OG/canonical/
   sitemap metadata point at a dead domain. The live host is
   `https://sadeem-website-theta.vercel.app`.

---

## 2. Commands + exact exit codes / الأوامر ورموز الخروج

| Command | Exit code | Notes |
|---|---|---|
| `node tests-v1128-site-guard.mjs` | **0** | 9 PASS / 0 FAIL / 3 WARN |
| `npm run build` | **0** | Next 16.4.6 (Turbopack); compiled in 1476ms; 10/10 static pages; routes `/`, `/auth`, `/changelog`, `/docs`, `/download`, `/features`, `/pricing`, `/sitemap.xml` |
| `npx tsc --noEmit` | **0** | no diagnostics |

---

## 3. Deployed-site check / فحص الموقع المنشور

| URL | HTTP | New markers (`id="watch"`, `demo-thinking`, `demo-tool`, `oc-ring`, `if-path`, `pg-line`, `ink-draw`) |
|---|---|---|
| `https://sadeem-website-theta.vercel.app/` | **200** | **ALL ABSENT** — old build |
| `https://sadeem-website-theta.vercel.app/features` | **200** | **ALL ABSENT** — old build |
| `https://sadeem-ai.com/` | DNS error | canonical domain does not resolve (`lib/site.ts:8`) |

**Status: PENDING DEPLOY.** The host answers 200, but the HTML is an older build —
`PLATE I`, `WATCH IT WORK`, `ink-draw`, `demo-stage` are all absent. After the parent
redeploy, re-run:

```powershell
$r = Invoke-WebRequest 'https://sadeem-website-theta.vercel.app/' -UseBasicParsing
@('id="watch"','demo-thinking','demo-tool','oc-ring','if-path','pg-line','ink-draw') |
  ForEach-Object { "$_ = $($r.Content.Contains($_))" }
```

---

## 4. What I cannot claim / ما لا أستطيع الادّعاء به

- I did **not** open a browser on the new build. Transform/opacity SVG line art may
  read as "refined" rather than "breathtaking"; that is a judgment only pixels can
  settle. **Source ≠ pixels.**
- No Lighthouse / FPS / bundle-size measurement was run. The components use
  `contain: layout paint`, pause offscreen and on hidden tabs, and animate only
  transform/opacity/stroke-dashoffset — that is a *design intent*, not a measurement.
- The app-in-use panel is a **stylised illustration**, explicitly labelled as such
  at `app/page.tsx:711`. It is not real captured output from the desktop app.

**Bottom line:** the W1–W5 work is substantive and builds clean. It is not proven
breathtaking, and as of this report the public site shows **none of it**.
