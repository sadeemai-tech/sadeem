# Microsoft Store Readiness Audit — SADEEM v11.12.0
# تدقيق الجاهزية لمتجر مايكروسوفت — سديم 11.12.0

**Audit timestamp / وقت التدقيق:** 2026-11-20 ~14:25–14:40 (local; D1 artifacts re-checked at ~14:35)
**Scope / النطاق:** diagnosis + documentation only. No app source, manifest, script, or config was modified by this audit. The only file written is this report.
**Policy baseline / مرجع السياسات:** Microsoft Store Policies v7.20, published 2026-09-15, effective 2026-10-22 (`https://learn.microsoft.com/en-us/windows/uwp/publish/store-policies`).

---

## 0. VERDICT — blunt, no sugar-coating / الحكم النهائي بصراحة

> ### ❌ NOT READY — غير جاهز
>
> **EN:** There is still no shippable Store package — but credit where due: D1 has now prepared a real APPX manifest template (`build/store/appx/appxmanifest.xml`, with `internetClient` + `runFullTrust`), all 8 correctly-sized Store logos (`build/store/logos/`), an `appx:` config block, three npm scripts, and an honest preflight that refuses to build on placeholders. **It is still NOT READY.** Reason 1: `appx.identityName` and `appx.publisher` are literal sentinels (`REPLACE_WITH_STORE_IDENTITY_NAME` / `CN=REPLACE_WITH_STORE_PUBLISHER_CN`) that only the user's Partner Center reservation can fill. Reason 2: no signing certificate exists. Reason 3 — the silent killer — **the generated manifest still has no `<uap:Protocol>` for `sadeem://`**: the template contains `${extensions}` (`appxmanifest.xml:71`) but `electron-builder.yml` has no `protocols` key, so the website's `sadeem://auth/callback` deep link will be dead in the Store build. Reason 4: the self-updater (`updateService.ts`) is still active and incompatible with Store updates. Bluntly: **D1 built a credible scaffold, not a submission — and the deep-link defect is a functional bug, not paperwork.**
>
> **AR:** ما زالت لا توجد حزمة قابلة للنشر، لكن يجب الإنصاف: D1 جهّز الآن قالب manifest حقيقياً (`build/store/appx/appxmanifest.xml` بصلاحيتي `internetClient` و`runFullTrust`) وصور متجر الثمانية بالأحجام الصحيحة وتهيئة `appx:` وثلاثة أوامر npm وفحصاً أولياً يرفض البناء مع العناصر النائبة. **لكنه ما زال غير جاهز.** السبب 1: الهوية والناشر ما زالا عنصرين نائبين لا يستطيع ملأهما إلا حجز المستخدم في Partner Center. السبب 2: لا توجد شهادة توقيع. السبب 3 — القاتل الصامت — **المانيفست المولّد لا يحتوي على `<uap:Protocol>` لبروتوكول `sadeem://`**: القالب يحوي `${extensions}` (`appxmanifest.xml:71`) لكن `electron-builder.yml` بلا مفتاح `protocols`، لذا سيكون رابط `sadeem://auth/callback` ميتاً في نسخة المتجر. السبب 4: المُحدِّث الذاتي ما زال فعّالاً وغير متوافق مع تحديثات المتجر. بصراحة: **D1 بنى هيكلة مقنعة، لا حزمة للإرسال — وعيب الرابط العميق خطأ وظيفي وليس مجرد ورقيات.**

### Hard blockers (ranked) / العوائق القاتلة مرتبةً

| # | Blocker | Evidence | Status |
|---|---------|----------|--------|
| 1 | APPX identity/publisher are placeholders pending Partner Center; no signed package can exist yet | `electron-builder.yml:123-124`; `scripts/store-preflight.mjs:43-67` | ❌ FAIL (honestly blocked) |
| 2 | No `sadeem://` protocol in the generated manifest — runtime registration is not enough for a packaged app | `main.ts:824-831`; `AppxTarget.js:281-292`; `build/store/appx/appxmanifest.xml:71`; `electron-builder.yml` has **no `protocols` key** | ❌ FAIL — **D1 defect** |
| 3 | No signing certificate; signing deliberately disabled; preflight can be fooled by env vars electron-builder v26 does not consume | `electron-builder.yml:29-80`; `tests/v1116-signing.test.mjs:68-74`; `scripts/store-preflight.mjs:70-96` | ❌ FAIL |
| 4 | No privacy policy URL hosted or declared (policy 10.5.1 — mandatory for Desktop Bridge/Win32) | only a prose section at `website/app/docs/page.tsx:291-319` | ❌ FAIL |
| 5 | Self-updater points at 3 different domains and cannot update a Store-signed package | `updateService.ts:25-28`; `website/lib/site.ts:8,27`; `electron-builder.yml:85-87` | ❌ FAIL |
| 6 | Store logos now prepared (8 PNGs, correct sizes) but not staged until `dist:store:assets`; `BadgeLogo.png` is only 142 bytes | `build/store/logos/`; `scripts/store-assets.mjs:26-35` | ⚠️ PARTIAL |
| 7 | No Partner Center work done by definition (name, pricing, age rating, screenshots) | user-only actions, see §3 | ⏳ PENDING |

---

## 1. Policy-by-policy audit with file:line evidence / التدقيق بنداً بنداً

### 1.1 App identity & version / هوية التطبيق والإصدار

**EN**
- `package.json:2` `name: "sadeem"`; `package.json:3` `productName: "SADEEM"`; `package.json:4` `version: "11.12.0"`.
- `electron-builder.yml:1` `appId: app.sadeem.desktop`; `:2` `productName: SADEEM`.
- `electron/main.ts:53-56` pins runtime identity with `app.setName('SADEEM')` and `userData/<appData>/SADEEM`; `:854` logs `app.getVersion()`.
- D1 added a manifest **template** at `build/store/appx/appxmanifest.xml` (macros only; `Identity` at `:30-33`), but the identity values themselves are still unresolved sentinels in `electron-builder.yml:123-124`: `REPLACE_WITH_STORE_IDENTITY_NAME` / `CN=REPLACE_WITH_STORE_PUBLISHER_CN`.
- electron-builder v26 fills `Identity Name` from `appx.identityName || appInfo.name` (`AppxTarget.js:214`) and `appInfo.name` is `metadata.name` = `sadeem` (`appInfo.js:114-116`). **The `appId: app.sadeem.desktop` (`electron-builder.yml:1`) is NOT used for APPX identity** — D1's explicit `appx.identityName` block correctly avoids the bare-`sadeem` fallback, but only once the sentinel is replaced with the real Partner Center value.
- `Version` is derived from `11.12.0` → `11.12.0.0` (`AppxTarget.js:169`; `appInfo.js:66-85`). This part is fine.
- `PublisherDisplayName` resolves to `SADEEM` from `author.name` (`package.json:9`; `appInfo.js:90-92`, `AppxTarget.js:159-163`) — fine in principle, but `author.email` is the placeholder `sadeem@app.local` (`package.json:10`); policy 10.14 requires real, current support contact info for a company-style publisher name.

**AR** أضاف D1 قالب manifest لكن الهوية والناشر ما زالا عنصرين نائبين في `electron-builder.yml:123-124` في انتظار حجز Partner Center. الإصدار `11.12.0.0` سليم، و`appId` لا يُستخدم لهوية APPX. بريد الدعم وهمي (`sadeem@app.local`) — وهذا مخالف لمتطلبات الهوية في المتجر.

**Verdict: ❌ FAIL** — identity must be explicitly authored and matched to the Partner Center reservation; `appId` and APPX `Identity Name` are different fields and currently disagree.

---

### 1.2 Declared capabilities — filesystem, network, terminal / الصلاحيات

**EN**

| Capability needed | Code evidence | What the package currently declares |
|---|---|---|
| Filesystem (arbitrary workspace read/write) | `electron/main.ts:8` `import fs`; `:55` `mkdirSync`; `:65` `cpSync`; `:151,159` `readFileSync`; `:197-226` renderer served from disk with traversal guard; `:16,850-853` fs confine root; `electron/ipc.ts:280` spawn `cwd` jail | nothing explicit — `runFullTrust` only, from electron-builder's stock template (`templates/appx/appxmanifest.xml`, `<rescap:Capability Name="runFullTrust"/>`) |
| Network (provider APIs, update feed, loopback control server) | `updateService.ts:25-28,81` generic HTTPS feed; `main.ts:186` CSP `connect-src` includes loopback http/ws; `electron/services/apiServerService.ts` + `remoteService.ts` run local HTTP/WS servers; AI providers called directly | nothing beyond `runFullTrust`; no `internetClient` declared |
| Terminal / arbitrary processes | `electron/ipc.ts:12` `import { spawn }`; `:204-238` allowlist + approval + cwd jail; `:278-281` `spawn(argv[0], …, shell:false)`; `:435-436` `kdx:term:exec`; `:444-461` approval gate; `electron/services/processService.ts` | `runFullTrust` present — but **restricted capability**, requires justification in Partner Center certification notes |

- Store policy **10.6**: "capabilities you declare must legitimately relate to the functions of your product." Here the app genuinely needs full trust (spawns processes, writes outside its package, runs loopback servers) — declare it and **explain it** in the notes; do not hide it.
- The template's only capability is `runFullTrust` (`templates/appx/appxmanifest.xml`, `<Capabilities>` block). If the packaged sandbox blocks outbound HTTPS without `internetClient`, AI calls and the updater will silently break — this must be tested on a real MSIX, not assumed.
- Store policy **10.2**: certificates/security are the developer's responsibility unless Store signing is used; policy **10.2.4**: disclose dependencies on non-integrated services (here: third-party AI providers) at the start of the description.

**AR** التطبيق يحتاج فعلياً إلى صلاحية `runFullTrust` لأنه يشغّل أوامر طرفية ويكتب ملفات خارج الحزمة ويشغّل خادم محلي. القالب الحالي يضيف `runFullTrust` فقط بلا أي تبرير أو تحقق من شبكة `internetClient`. سياسة المتجر 10.6 تشترط أن تكون الصلاحيات مُبرَّرة ومعلنة.

**Verdict: ⚠️ PARTIAL** — the capability class is technically present via the stock template, but it is undisclosed, untested and undocumented; network capability is unverified.

---

### 1.3 Privacy policy URL / رابط سياسة الخصوصية

**EN**
- Policy **10.5.1** requires a privacy policy and its URL entered in Partner Center; "Desktop Bridge and Win32 products" **always** require one. SADEEM is a Win32/Electron full-trust app → mandatory, no exemption.
- The app collects/transmits personal data: email + name in the auth deep link (`main.ts:769-780`), provider API keys (`package.json:5`, encrypted locally), plan/license info (`electron/services/licenseService.ts`, `billingService.ts`).
- Repo has **no dedicated privacy page** and **no privacy URL in any package config**. The only text is a 1-paragraph docs section at `website/app/docs/page.tsx:291-319` (English + Arabic), hosted (if deployed) under the canonical domain `website/lib/site.ts:8` `https://sadeem-ai.com`. That page also contradicts Store metadata expectations: it says "no account database, no password, no email verification" while the app does create a local account/plan via `completeWebAuth` (`main.ts:793`).
- `package.json:10` author email `sadeem@app.local` cannot be used as a support contact; `website/lib/site.ts:28` has the real one: `support@sadeem.app`.

**AR** سياسة المتجر 10.5.1 تُلزم كل تطبيق Win32/Desktop Bridge بسياسة خصوصية ورابط يُدخل في Partner Center. لا توجد صفحة خصوصية مستقلة ولا رابط مُصرَّح به في أي ملف حزمة؛ يوجد فقط مقطع قصير داخل صفحة Docs. كما أن البريد الوارد في `package.json` وهمي.

**Verdict: ❌ FAIL** — user must host a real, accurate privacy policy and paste its URL in Partner Center (see §3).

---

### 1.4 App identity / deep-link registration — `sadeem://` vs `surnia://`

**EN — this is the single most important technical mismatch**
- `surnia://` is **NOT an OS deep link**. It is an internal privileged scheme registered at `electron/main.ts:91-96` (`protocol.registerSchemesAsPrivileged`, `scheme: 'surnia'`) and served by `protocol.handle('surnia', …)` at `:197-233`, used to load the renderer from `surnia://bundle/index.html` (`:398`, `electron/ipc.ts:318-333`). It never appears in the website or in any activation handler.
- The **real OS deep link is `sadeem://`**: `electron/main.ts:769` regex `^sadeem:\/\/auth\/callback\?(.+)$`; `:811` `second-instance`; `:820` `open-url`; `:824-831` `app.setAsDefaultProtocolClient('sadeem')`; and website confirmation at `website/lib/site.ts:11-12` (`deepLinkScheme: 'sadeem'`) and `website/app/auth/page.tsx:16,135`.
- For a packaged MSIX/APPX, protocol registration must be in the manifest (`<uap:Extension Category="windows.protocol"><uap:Protocol Name="sadeem">…`). electron-builder only emits that when `protocols`/`appx.protocols` is configured (`AppxTarget.js:281-292`). D1's custom manifest contains the `${extensions}` slot (`build/store/appx/appxmanifest.xml:71`), **but `electron-builder.yml` still has no `protocols` key** → that slot expands to an empty string → generated manifest has **no protocol extension at all**. Runtime `setAsDefaultProtocolClient` on a packaged app is not a substitute.
- If D1 adds a protocol entry, it must be **`sadeem`**. Declaring `surnia` would register a scheme with no handler in the code (dead link) and would still leave the real `sadeem://auth/callback` broken.
- Neither `scripts/store-preflight.mjs` nor `build/store/README.md` checks or mentions protocol registration — so this defect passes all current gates unnoticed.

**AR** `surnia://` ليس رابط نظام تشغيلي بل بروتوكول داخلي لتحميل واجهة التطبيق (`main.ts:91-96,197`). الرابط الحقيقي هو `sadeem://` (`main.ts:769,824-831` وموقع الويب `site.ts:11-12`). ملف APPX المولّد حالياً لا يسجّل أي بروتوكول لأن التهيئة لا تحتوي على `protocols`. يجب إضافة `sadeem` — لا `surnia` — إلى manifest.

**Verdict: ❌ FAIL** — and a direct defect in D1's current output (see §2.2).

---

### 1.5 Auto-update mechanism / آلية التحديث الذاتي

**EN**
- `electron/services/updateService.ts:1-14` states the honest contract: generic feed, manual check + one check 10 min after boot, unsigned NSIS installs.
- `:25-28` default feed `https://sadeem.app/updates/`; `:38-49` only https (or loopback) accepted; `:75-99` `electron-updater` autoUpdater wiring; `:128-159` IPC `check/download/install/quitAndInstall`; `:162-172` scheduled auto-check.
- Three conflicting domains exist in one repo:
  - `updateService.ts:27` → `https://sadeem.app/updates/`
  - `website/lib/site.ts:27` → `https://sadeem-website-theta.vercel.app/updates/`
  - `website/lib/site.ts:8` (canonical) → `https://sadeem-ai.com`
- A Store-distributed APPX/MSIX is updated by the Store; an NSIS `quitAndInstall()` from an external feed cannot replace a packaged app and is inconsistent with Store distribution. Policy **10.2.5** requires Store-managed install/update for supported package submissions; the alternative **10.2.9** route (versioned HTTPS installer URL) demands a **silent** installer and signed PE files — current NSIS config is explicitly interactive (`electron-builder.yml:85-87`: `oneClick:false`, `perMachine:false`, `allowToChangeInstallationDirectory:true`).
- Required: gate `scheduleAutoCheck()` / `kdx:update:*` off (or make it read-only "updates come from the Store") when running with package identity; align all feed/domain strings; document the update model in Partner Center notes.

**AR** آلية التحديث الحالية (`electron-updater` + `quitAndInstall`) مخصصة لمثبت NSIS ولا تعمل مع حزمة Metجر، وتشير إلى ثلاثة نطاقات مختلفة. يجب تعطيلها أو تحويلها إلى رسالة "التحديثات عبر المتجر" في نسخة المتجر، وتوحيد الروابط. مسار 10.2.9 البديل يتطلب مثبتاً صامتاً بينما المثبت الحالي تفاعلي.

**Verdict: ❌ FAIL**

---

### 1.6 Logo / Store assets / صور المتجر

**EN**
- `build/icon.ico` (256×256) and `build/icon.png` (512×512) are the only image assets (verified with System.Drawing on 2026-11-20). `electron-builder.yml:15` points `win.icon` at `build/icon.ico`.
- D1 has since added `build/store/logos/` with all 8 PNGs at the exact sizes electron-builder expects (`StoreLogo` 50×50, `Square44x44Logo` 44×44, `Square150x150Logo` 150×150, `SmallTile` 71×71, `LargeTile` 310×310, `Wide310x150Logo` 310×150, `SplashScreen` 620×300, `BadgeLogo` 24×24 — verified 2026-11-20). `scripts/store-assets.mjs:26-35` validates and stages them into `build/appx/` (the directory electron-builder actually reads, `electron-builder.yml:6,133`).
- Caveat: `BadgeLogo.png` is only 142 bytes at 24×24 — check it is not a blank/solid placeholder before submission. Electron-builder's sample-image fallback (`AppxTarget.js:10-16,90-98`) is avoided only if `dist:store:assets` is run.
- Still required from the user: Partner Center listing screenshots of the real UI (EN + AR) per policy **10.1 / 11.1 / 11.2**.

**AR** أضاف D1 مجموعة الصور الثمانية بالأحجام الصحيحة وسكربتاً للتحقق والنسخ إلى `build/appx/`. ملاحظة: صورة `BadgeLogo.png` حجمها 142 بايت فقط — يُنصح بفحصها. يبقى على المستخدم رفع لقطات شاشة حقيقية في Partner Center.

**Verdict: ⚠️ PARTIAL**

---

### 1.7 Package signing & certificate / توقيع الحزمة والشهادة

**EN**
- `electron-builder.yml:29-80` — all signing keys are comments on purpose; `tests/v1116-signing.test.mjs:68-82` asserts they stay disabled. `:75` shows the only publisher string in the repo: `CN=SADEEM, O=SADEEM, C=XX` — `C=XX` is a placeholder, not a country.
- `scripts/sign-windows.cjs:22` signs **only** `release/SADEEM-Setup-11.12.0.exe` (the NSIS installer), not an `.appx`; `:51-56` explicitly requires a real OV/EV cert; `:70` timestamps via DigiCert.
- D1 adds `appx.publisher: CN=REPLACE_WITH_STORE_PUBLISHER_CN` (`electron-builder.yml:124`) and a preflight that blocks while sentinels remain (`scripts/store-preflight.mjs:43-67`) — good honesty, but still unresolved.
- **New defect in the gate:** `scripts/store-preflight.mjs:70-96` treats `STORE_CERT_SUBJECT` and bare `AZURE_*` variables as sufficient signing credentials, but electron-builder v26 has no native consumer for them without a custom sign hook / `certificateSubjectName` (the repo's own comment at `electron-builder.yml:68-69` admits a custom hook or `jsign` is needed for Azure in v26). Preflight can therefore report PASS while the build is still unsigned — do not trust a green preflight as proof of signing.
- electron-builder's AppX target calls `packager.sign(artifactPath)` (`AppxTarget.js:104`); with no certificate it logs "AppX is not signed" and would set `Publisher="CN=ms"` (`windowsSignToolManager.js:110-114`). `CN=ms` will not match a real Partner Center publisher.
- Two acceptable routes: (a) buy EV/OV cert and set `appx.publisher` to its exact subject + sign in CI; or (b) upload unsigned APPX and let the Store sign it — still requires `Identity Publisher` to equal the publisher string issued in Partner Center. Either way, the user must create/verify the publisher identity in Partner Center; nothing in the repo can do that.

**AR** التوقيع معطَّل عمداً، والشهادة غير موجودة، والناشر الوحيد المكتوب يحوي `C=XX` كعنصر وهمي. سكربت التوقيع يوقّع ملف NSIS فقط. الحزمة المولّدة ستكون بلا توقيع وبناشر `CN=ms`، وهو غير مطابق لأي ناشر حقيقي في Partner Center.

**Verdict: ❌ FAIL**

---

## 2. D1 consistency check — exact findings / تدقيق مخرجات D1

**Status at final check (~14:35):** D1 produced a coherent scaffold:
`electron-builder.yml` (`appx` target at `:23-27`, full `appx:` block at `:95-137`), `build/store/appx/appxmanifest.xml`, 8 logos in `build/store/logos/`, `scripts/store-preflight.mjs`, `scripts/store-assets.mjs`, `package.json:48-50` (`dist:store`, `dist:store:check`, `dist:store:assets`), and `build/store/README.md` (EN/AR). Verdict: **better than the interim one-line state, still NOT shippable — one real functional defect and three unresolved external prerequisites.**

### 2.1 Manifest identity ↔ package ↔ signing subject

| Field | D1's value | Source | Expected | Mismatch? |
|---|---|---|---|---|
| APPX `Identity Name` | `REPLACE_WITH_STORE_IDENTITY_NAME` | `electron-builder.yml:123` | exact Partner Center reserved identity (3–50 chars) | ⏳ sentinel — preflight blocks (`store-preflight.mjs:43-51`); must be filled by user |
| APPX `Identity Publisher` | `CN=REPLACE_WITH_STORE_PUBLISHER_CN` | `electron-builder.yml:124` | Partner Center publisher CN = certificate Subject CN | ⏳ sentinel — preflight blocks; also note `C=XX` placeholder in the old comment at `electron-builder.yml:75` is a *third* publisher string, delete it to avoid confusion |
| APPX `Identity Version` | `11.12.0.0` from `11.12.0` | `electron-builder.yml:135` (`setBuildNumber:false`), `package.json:4`, `AppxTarget.js:169` | `11.12.0.0` | ✅ OK |
| `applicationId` / `Executable` / `PublisherDisplayName` | `SADEEM.SADEEM` / `app\SADEEM.exe` / `SADEEM` | `electron-builder.yml:125-127`; `AppxTarget.js:163`; `appInfo.js:90-92` | same | ✅ OK (valid regex, 1–64 chars) |
| Capabilities | `internetClient` + `runFullTrust` | `build/store/appx/appxmanifest.xml:52-55` | both present for this app | ✅ OK |
| `customManifestPath` | `store/appx/appxmanifest.xml` → `build/store/appx/appxmanifest.xml` | `electron-builder.yml:6,133`; `platformPackager.js:583-598` resolves custom resources against `buildResourcesDir` | file exists | ✅ OK |
| Signing subject | **none**; env-only, deliberately uncommitted | `electron-builder.yml:29-80`; `tests/v1116-signing.test.mjs:68-82` | real cert whose CN == `Identity Publisher` | ❌ FAIL — external prerequisite |

### 2.2 Protocol registration — ❌ REAL DEFECT, exact mismatch

- D1's manifest has the `${extensions}` macro at `build/store/appx/appxmanifest.xml:71`, but electron-builder fills it only from `protocols`/`appx.protocols` (`AppxTarget.js:281-292`). **`electron-builder.yml` contains no `protocols` key at all** (verified by search) → generated `<Extensions>` is `""` → **no `windows.protocol` registration**.
- Code requires **`sadeem`** (`electron/main.ts:769,824-831`; `website/lib/site.ts:11-12`); internal `surnia` (`main.ts:91-96`) must not be used.
- Neither `scripts/store-preflight.mjs` nor `build/store/README.md` checks this → the defect passes every current gate.
- **Exact fix required:** add to `electron-builder.yml`:
  ```yaml
  protocols:
    - schemes: [sadeem]
      name: "SADEEM authentication callback"
  ```
- Effect if unfixed: the website's `sadeem://auth/callback?pair=…` (`website/app/auth/page.tsx:16,135`) will not launch the packaged app; users cannot pair accounts from the Store build.

### 2.3 Gate / asset / command consistency

- `dist:store` (`package.json:48`) = preflight → `npm run full` → `store-assets` → `electron-builder --win appx`: correct order. `dist:win` (`package.json:47`) still builds only nsis/zip by design. ✅
- Logos: 8 PNGs at exact sizes in `build/store/logos/`, validated and staged by `scripts/store-assets.mjs:26-35` → sample-asset fallback avoided. ⚠️ `BadgeLogo.png` is only 142 bytes; verify visually.
- `scripts/store-preflight.mjs:70-96` accepts `STORE_CERT_SUBJECT` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_CLIENT_CERTIFICATE_PATH` as "signing credential", but electron-builder v26 has no native consumer for these without a custom sign hook (`electron-builder.yml:68-69` says exactly that). **A green preflight can still produce an unsigned package.** ❌ gate defect.
- No msix target exists in v26 (`node_modules/app-builder-lib/out/targets/` has only `AppxTarget.*`) — D1's README claim at `build/store/README.md:36-41` is correct. ✅
- Signed-artifact script `scripts/sign-windows.cjs:22` still targets only the NSIS `.exe`; no `.appx` signing path exists yet. ⚠️
- Self-updater not gated for package identity — `updateService.ts` remains unchanged. ❌

### 2.4 What parent must demand from D1 before accepting the output

1. **Add `protocols: [{ schemes: [sadeem], name: … }]`** — the only functional defect; do not register `surnia`.
2. Delete the stale `CN=SADEEM, O=SADEEM, C=XX` comment (`electron-builder.yml:75`) so exactly one publisher string exists.
3. Fix the preflight's credential detection: only `WIN_CSC_LINK`/`CSC_LINK` + password (or a verified custom signing hook) should count; otherwise a green PASS is misleading.
4. After the user reserves the name, fill `identityName`/`publisher` with the exact Partner Center strings and verify the signed APPX manifest via `makeappx unpack` + `signtool verify /pa` (README §4 is a good checklist).
5. Gate/disable `electron-updater` in the packaged build (or document Store-managed updates) and align the 3 feed domains.
6. Add a regression test (pattern: `tests/v1116-signing.test.mjs:40-95`) asserting `protocols`, identity/publisher non-placeholder, and version strings so drift is caught.

---

## 3. What ONLY the user can do in Partner Center / ما يجب على المستخدم فعله في Partner Center

**EN — exact checklist (none of this can be done in the repo):**

1. **Enroll & account type.** Decide Individual vs Company. Policy **10.14**: a name like "SADEEM" that reads as a business, and any product needing financial info, requires a **Company** account with business verification. Provide real customer-support contact info (replace `sadeem@app.local`, `package.json:10`).
2. **Reserve the app name** — "SADEEM" (or chosen exact title). Policy **10.1.1**: unique, no marketing words/keywords in the title; must not mislead. The reserved name determines the identity you must use in `appx.identityName` / manifest — lock this before D1 finalises.
3. **Pricing / availability.** Set Free or a price; if paid, add payment/tax/banking details. Policies **10.8.x** apply to any in-app purchases or subscriptions; disclose third-party purchase APIs if used.
4. **Privacy policy URL.** Host a real, public, accurate policy (recommended: `https://sadeem-ai.com/privacy`) covering: name/email from `sadeem://auth/callback`, API keys and their local encryption, direct calls to third-party AI providers, local data storage, no telemetry, user controls (clear/export), and contact email. Paste the URL into the Partner Center submission field (policy **10.5.1**). The current `/docs#privacy` prose is not enough and contains a factual contradiction about accounts.
5. **Age rating (IARC).** Complete the questionnaire during submission (policy **11.11.1**). Because the app includes Live Preview of arbitrary web content and user-generated code, answer honestly about user-generated content and web browsing; note policy **11.1** caps metadata content at PEGI 12 / ESRB E10+ or lower.
6. **Screenshots & listing assets.** Upload real screenshots of the desktop UI in English **and** Arabic/RTL, a 1×1 app icon for the listing, short/full descriptions, and search terms (≤7, policy **10.1.3**). They must match actual functionality (policy **10.1 / 11.2**).
7. **Publisher certificate / identity.** Create the publisher identity in Partner Center and either (a) obtain an EV/OV code-signing cert whose subject matches `Identity Publisher` and configure CI, or (b) choose Microsoft Store signing and ensure the manifest `Publisher` equals the publisher string assigned by Partner Center. `CN=ms` and `C=XX` will not pass.
8. **Certification notes.** Disclose: `runFullTrust` and why (terminal spawning, arbitrary workspace FS access, loopback HTTP control server), third-party AI provider dependencies (policy **10.2.4**), update model, and any credentials needed to test (policy **10.3.1/10.3.2** — a demo account/server must work).
9. **Submit & respond to certification.** Watch for WACK/Store certification feedback and iterate; nothing in this repo has been run through WACK.

**AR — قائمة دقيقة (لا يمكن إنجاز أي منها داخل المستودع):**
1. إنشاء حساب Partner Center وتحديد نوعه (فردي/شركة — السياسة 10.14) وتقديم بريد دعم حقيقي.
2. حجز اسم التطبيق "SADEEM" قبل تثبيت هوية APPX (السياسة 10.1.1).
3. تحديد السعر (مجاني/مدفوع) وبيانات الدفع والضرائب (10.8).
4. نشر صفحة سياسة خصوصية حقيقية وإدخال رابطها في Partner Center (10.5.1) — المقطع الحالي في `/docs#privacy` غير كافٍ ومتناقض.
5. تعبئة استبيان التصنيف العمري IARC (11.11.1) مع مراعاة المحتوى المُولَّد من المستخدم والمعاينة الحية (11.1).
6. رفع لقطات شاشة حقيقية بالإنجليزية والعربية ووصف المتجر (10.1/10.1.3/11.2).
7. إنشاء هوية الناشر وشهادة التوقيع (أو توقيع المتجر) ومطابقتها تماماً مع `Identity Publisher` في manifest.
8. كتابة ملاحظات الاعتماد: سبب `runFullTrust`، الاعتماد على مزودي AI، نموذج التحديث، وبيانات تجريبية للاختبار (10.2.4/10.3).
9. تقديم الطلب ومتابعة ملاحظات الاعتماد؛ لم يتم تشغيل WACK على أي حزمة حتى الآن.

---

## 4. What CAN be prepared in-repo / ما يمكن تجهيزه داخل المستودع

**EN — already prepared in-repo by D1 (verified):** `appx:` config block with version mapping (`electron-builder.yml:95-137`), custom manifest with `internetClient`+`runFullTrust` (`build/store/appx/appxmanifest.xml`), 8 correctly-sized logos + staging/validation script (`build/store/logos/`, `scripts/store-assets.mjs`), fail-fast preflight (`scripts/store-preflight.mjs`), three npm scripts (`package.json:48-50`), and the bilingual submission guide (`build/store/README.md`). Credit where due — that is real work.

**EN — still to prepare in-repo (owned by D1 / parent; deliberately NOT modified by this audit):**
- **`protocols` entry for `sadeem` only** — the missing functional piece (§2.2).
- Fix preflight credential detection (§2.3) so a green PASS actually means signing is configured; add an `.appx` signing path (extend `scripts/sign-windows.cjs:22`).
- A Store build of `updateService.ts` that disables self-update IPC when `app.isPackaged` + package identity is present; align the 3 feed domains.
- A standalone `website/app/privacy/page.tsx` draft (then the user deploys it and pastes the URL in Partner Center).
- A certification-notes draft file and a regression test asserting identity/scheme/publisher strings (pattern: `tests/v1116-signing.test.mjs:40-95`).
- WACK run instructions/checklist in `docs/` once an APPX exists; remove the stale `C=XX` comment.

**AR:** يمكن تجهيز الشعارات وتهيئة APPX وبروتوكول `sadeem` وسكربت البناء والتوقيع وتعطيل التحديث الذاتي ومسودة صفحة الخصوصية وملاحظات الاعتماد واختبار مطابقة الهوية داخل المستودع — لكن نشرها في المتجر وربطها بهوية الناشر لا يتم إلا من قِبل المستخدم في Partner Center.

---

## 5. Evidence index / فهرس الأدلة

| Claim | File:line |
|---|---|
| product/name/version | `package.json:2-5` |
| placeholder support email | `package.json:10` |
| dist:win builds only nsis+zip | `package.json:47` |
| appId, productName, D1 appx target | `electron-builder.yml:1-2,23-27` |
| signing disabled / placeholder subject | `electron-builder.yml:29-80` (`C=XX` at `:75`) |
| NSIS interactive settings | `electron-builder.yml:85-87` |
| runtime identity SADEEM + userData | `electron/main.ts:53-56,854` |
| internal surnia:// scheme | `electron/main.ts:91-96,197-233,398` |
| webPreferences sandbox | `electron/main.ts:311-327` |
| sadeem:// deep link handlers | `electron/main.ts:757,769,811,820,824-836` |
| filesystem use | `electron/main.ts:8,55,65,151,159,203-226,850-853` |
| process spawn / terminal | `electron/ipc.ts:12,204-238,278-281,435-436,444-461` |
| updater contract + feed | `electron/services/updateService.ts:1-14,25-28,38-49,75-99,128-172` |
| canonical site / deep link / conflicting feed | `website/lib/site.ts:8,11-12,27,28` |
| privacy prose only | `website/app/docs/page.tsx:291-319` |
| signer targets NSIS only | `scripts/sign-windows.cjs:22,51-56,70` |
| D1 appx identity/publisher sentinels | `electron-builder.yml:122-135` |
| custom manifest (capabilities; `${extensions}`) | `build/store/appx/appxmanifest.xml:52-55,71` |
| no protocol key in config (defect) | `electron-builder.yml` (no `protocols`) vs `AppxTarget.js:281-292` |
| store logos (8 PNGs, validated) | `build/store/logos/`; `scripts/store-assets.mjs:26-35` |
| preflight / dist:store scripts | `scripts/store-preflight.mjs:31-105`; `package.json:48-50` |
| preflight credential false-PASS risk | `scripts/store-preflight.mjs:70-96` vs `electron-builder.yml:65-69` |
| bilingual store guide | `build/store/README.md:1-184` |
| signing deliberately disabled (test) | `tests/v1116-signing.test.mjs:40-95` |
| icon assets | `build/icon.ico` (256×256), `build/icon.png` (512×512) |
| electron-builder APPX defaults | `node_modules/app-builder-lib/out/targets/AppxTarget.js:10-16,90-98,104,163,169,214,281-292` |
| `CN=ms` fallback | `node_modules/app-builder-lib/out/codeSign/windowsSignToolManager.js:110-114` |
| `identityName` = package name | `node_modules/app-builder-lib/out/appInfo.js:114-116` |
| runFullTrust-only manifest template | `node_modules/app-builder-lib/templates/appx/appxmanifest.xml` (`<Capabilities>`) |
| Store policies v7.20 | 10.1.1, 10.1.3, 10.2, 10.2.4, 10.2.5, 10.2.9, 10.3.1-2, 10.5.1, 10.6, 10.8, 10.14, 11.1, 11.2, 11.11.1 |

---

**Final word / كلمة أخيرة:** Do not present this app as "Store-ready" until §2's four mismatches (identity, publisher, protocol, logos) are fixed in files and §3's nine Partner Center actions are completed by the user. Until then the honest label is **NOT READY**, and any Store submission will fail certification or ship a broken deep link.
