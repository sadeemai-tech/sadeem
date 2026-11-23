# SADEEM Website — Final Verification
# التحقق النهائي من موقع سديم

**Date / التاريخ:** 2026-11-19
**Version / الإصدار:** v11.12.0
**Verified by / أعدّ التحقق:** Website verification pass (source + live deployment)

---

## 1. Deployment status / حالة النشر

| Item | Status |
|---|---|
| Live deployment (Vercel) | ✅ Live and serving — https://sadeem-website-theta.vercel.app |
| Production build | ✅ `npm run build` passes — 8 static routes generated |
| TypeScript | ✅ `npx tsc --noEmit` passes with exit code 0 |
| Canonical domain | ⏳ `sadeem-ai.com` — **not yet purchased**, does not resolve yet |
| Marketing pages | ✅ 7 of 8 pages correct on live; **`/docs` returns 404** (see §5) |
| Release binaries | ✅ Both Vercel Blob artifacts return HTTP 200 |
| Update feed | ✅ `/updates/latest.yml` returns HTTP 200 with valid YAML |

### URLs / الروابط

| Purpose | URL |
|---|---|
| Live site (current) | `https://sadeem-website-theta.vercel.app` |
| Canonical / future domain | `https://sadeem-ai.com` (not owned yet) |
| Download | `/download` |
| Pricing | `/pricing` |
| Features | `/features` |
| Docs | `/docs` — **broken on live, fix pending** |
| Auth / pairing | `/auth` |
| Changelog | `/changelog` |
| Sitemap | `/sitemap.xml` |
| Robots | `/robots.txt` |
| Update feed | `/updates/latest.yml` |
| Source | `https://github.com/sadeem-ai/sadeem` |

---

## 2. Live page-by-page verification / تحقق الصفحات

| Page | HTTP | Content check |
|---|---|---|
| `/` | 200 | ✅ Arabic-default RTL, hero, bilingual feature rows, bilingual PLAYBOOK specimen, no subscription claim |
| `/download` | 200 | ✅ Bilingual, Windows-only, honest unsigned/SmartScreen note, both SHA-256 hashes shown |
| `/pricing` | 200 | ✅ Explicit `FREE_SEASON = true`, "no subscription / no monthly fees" (بلا اشتراك · بلا رسوم شهرية), "$0 collected today" — no monthly subscription is sold |
| `/features` | 200 | ✅ Bilingual tool catalog, 142 tools / 12 providers / 20+ MCP / 12 subagents |
| `/auth` | 200 | ✅ Bilingual six-character pairing flow, deep-link explanation, no server-side account |
| `/docs` | **404** | ❌ Live 404 — source page exists and builds locally; deploy-side exclusion (see §5) |
| `/changelog` | 200 | ✅ 10 releases, bilingual, honest "date not stated in release notes" labels |
| `/sitemap.xml` | 200 | ✅ Valid XML, exactly 7 URLs, correct priorities/change frequencies |
| `/robots.txt` | 200 | ✅ `Allow: /`, sitemap directive present |

**Hashes / البصمات** — displayed values match `lib/site.ts` exactly:
- Setup: `10c1a88520b14d503047c8599036af5e6fe5303dfda978f605434796163fa6c5`
- ZIP: `f9fcbfd1e02b5a8e75f039e87795483b54ad513b149fa001c396e87040786109`

Artifact reachability / توفر الملفات:
- `SADEEM-Setup-11.12.0.exe` → 200, 113,068,190 bytes
- `SADEEM-11.12.0-win.zip` → 200, 150,894,274 bytes

`11.12.0` repeated six times in the download-page seal is an intentional decorative SVG
ring (`'11.12.0 · '.repeat(6)`), not stale data.

---

## 3. SEO verification / تحقق تحسين محركات البحث

Verified in the live HTML head / تم التحقق من رأس الصفحة المباشرة:

- ✅ `<title>` and meta description (Arabic-first, no monthly subscription claim)
- ✅ `<link rel="canonical" href="https://sadeem-ai.com">`
- ✅ Open Graph: `og:type`, `og:title`, `og:description`, `og:url`, `og:site_name`,
  `og:locale=ar_SA`, `og:locale:alternate=en_US`, `og:image` (256×256 PNG)
- ✅ Twitter: `summary_large_image`, title, description, image
- ✅ JSON-LD `SoftwareApplication` — name, version `11.12.0`, category, OS, price `0`,
  `InStock`, download URL
- ✅ `robots` / `googlebot` index+follow with max snippet / large image preview
- ✅ Icons (PNG + SVG favicon)
- ✅ Sitemap: 7 URLs — `/`, `/features`, `/download`, `/pricing`, `/docs`, `/changelog`, `/auth`
- ✅ robots.txt with `Sitemap: https://sadeem-ai.com/sitemap.xml`

**No change was needed in `layout.tsx`** — the SEO output is correct. Canonical/OG/sitemap
deliberately point at the future domain `sadeem-ai.com` per `lib/site.ts`; this becomes
authoritative once the domain is bought and pointed at Vercel.

---

## 4. Mixed-language audit + polish applied / التدقيق اللغوي والتحسينات

Scanned every `tx('en', 'ar')` pair in `website/**/*.tsx`. Nine candidates were found and
reviewed: all are legitimate technical terms, file paths, key names, brand names, or the
intentional language-toggle label — **no genuine mixed-language sentences remain**.
Two genuine issues in owned files were fixed:

1. **`app/page.tsx`** — the stats strip rendered English captions (`TOOLS`, `PROVIDERS`,
   `SUBAGENTS`, `LOCAL`) in the Arabic layout. Captions are now bilingual via `tx()`;
   `app/home.css` renders them in the Arabic typeface under `lang="ar"`.
2. **`components/chrome.tsx`** — language/menu buttons had hardcoded English `aria-label`s.
   They are now localized, and the menu button exposes `aria-expanded`.

Glass / liquid art, polished one notch (additive, theme-aware, no new colours):
- `app/globals.css` — when `backdrop-filter` is unsupported, the glass sheet falls back to
  a stronger theme-token paper tint so it stays legible; in forced-colours mode the
  decorative layer steps aside entirely.
- `app/home.css` — the hero caustic is dimmer on dark paper (a glint, not a glow).
- Existing reduced-motion / `data-art='off'` / coarse-pointer kill switches remain intact.

---

## 5. Blocking issue — action required outside this file scope / عائق يتطلب إجراءً

### `/docs` is 404 on the live deployment

- **Symptom:** `GET /docs` → 404. The nav and sitemap both link to it.
- **Root cause (confirmed):** `website/.vercelignore` contains an unanchored `docs/`.
  With gitignore semantics this matches **any** directory named `docs`, including
  `app/docs/`, so Vercel excludes the route from the build. Verified with
  `git check-ignore`: `docs/` matches both `docs/RESEARCH.md` and `app/docs/page.tsx`.
- **Local build is fine:** `npm run build` generates `○ /docs`.
- **Fix:** change the line `docs/` to `/docs/` (anchor it to the repo root) in
  `website/.vercelignore`, then **redeploy**. `.vercelignore` is outside this agent's
  editable file scope, so it was not modified here.
- Note: the sitemap last-modified timestamp is generated at build time, so a fresh deploy
  that predates the docs page can still advertise `/docs` — the 404 is the exclusion above.

### Non-blocking build warnings
- Repo-root `postcss.config.js` has no declared module type (`MODULE_TYPELESS_PACKAGE_JSON`).
- Tailwind `content` option is missing/empty (no Tailwind CSS is actually used by this app).
Both are pre-existing warnings; the build exits 0.

---

## 6. Pending before launch / قيد الانتظار قبل الإطلاق

1. **Domain / النطاق** — buy `sadeem-ai.com`, point DNS to the Vercel project, and confirm
   canonical/OG/sitemap resolve on the real domain. No code change is required for the URL
   itself (`SITE.siteUrl` already points there); the preview URL will keep working.
2. **Redeploy / إعادة النشر** — ship the `.vercelignore` fix so `/docs` goes live.
3. **Optional code signing / التوقيع الاختياري** — the v11.12.0 build is unsigned, so Windows
   Defender SmartScreen shows a warning. The download page explains this honestly. Signing
   with an EV/OV certificate would remove it but is not required for launch.
4. **Optional OG card / بطاقة مشاركة اختيارية** — the current social image is the 256×256 app
   logo. A 1200×630 designed card would improve link previews.
5. **Release pipeline / خط الإصدار** — keep publishing binaries to Vercel Blob and
   regenerating `public/updates/latest.yml` with `scripts/publish-release.mjs` for each release.

---

## 7. Verified by / تم التحقق بواسطة

```
cd website
npx tsc --noEmit     # exit 0
npm run build        # exit 0, 8 static routes
```

Live checks: `/`, `/download`, `/pricing`, `/features`, `/auth`, `/changelog`,
`/sitemap.xml`, `/robots.txt`, `/updates/latest.yml`, both Blob artifacts, favicon and logo.
