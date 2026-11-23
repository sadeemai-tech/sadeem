# SADEEM release channel / قناة الإصدارات

> **Read this first:** the in-app updater is **already implemented and wired**.
> `electron/services/updateService.ts` wraps `electron-updater`, is registered in
> `electron/ipc.ts` (`kdx:update:*`), exposed in `electron/preload.ts` and
> `src/lib/api.ts`, and has a Settings → Updates UI. It does a manual
> **"Check now"**, one quiet automatic check **10 minutes after boot**, never
> auto-downloads, and lets the user edit an **HTTPS-only** feed URL.
>
> What is **actually missing** is not the code — it is (a) a **published, real
> feed + artifacts** at `https://sadeem.app/updates/` and
> (b) a **Windows code-signing certificate**. Without those, the app can check
> for updates but has nothing valid to find, and Windows SmartScreen warns.

> **اقرأ أولاً:** أداة التحديث داخل التطبيق **موجودة وموصولة بالفعل**.
> الملف `electron/services/updateService.ts` يغلّف `electron-updater`، ومسجّل في
> `electron/ipc.ts` و`electron/preload.ts` و`src/lib/api.ts`، وله واجهة في
> الإعدادات → التحديثات. يوفّر «فحص الآن» يدوياً، وفحصاً هادئاً مرة واحدة بعد
> 10 دقائق من الإقلاع، ولا ينزّل شيئاً تلقائياً، ويسمح بتعديل خلاصة HTTPS فقط.
>
> **الناقص فعلياً** ليس الكود، بل (أ) **خلاصة وملفات منشورة حقيقية** على
> `https://sadeem.app/updates/` و(ب) **شهادة توقيع Windows**. بدونها يستطيع
> التطبيق الفحص لكنه لن يجد شيئاً صالحاً، وسيظهر تحذير SmartScreen.

---

## English — publishing vNext

### 0. Prerequisites

- Node 18+ on Windows.
- `npm install` already done at the repo root.
- A static HTTPS host for the website (any CDN / GitHub Pages / nginx / S3).
- **No signing certificate yet** — this is expected; see step 6.

### 1. Build the app and the Windows artifacts

```bat
npm run full
npm run dist:win
```

`electron-builder.yml` puts the installer in `release/`:

- `release/SADEEM-Setup-<version>.exe` (NSIS installer — the primary update artifact)
- `release/SADEEM-<version>.zip` (portable/zip build, optional companion)

Confirm the file name contains the exact version from `package.json`.

### 2. Generate the static feed (no upload happens here)

```bat
node scripts/publish-release.mjs
```

The script:

1. finds the newest `release/SADEEM-Setup-*.exe` and matching `*.zip`;
2. computes **SHA-512 (base64)** and **SHA-256 (hex)** for each;
3. overwrites `website/public/updates/latest.yml` with a real feed;
4. copies the artifacts + `SHA256SUMS.txt` into `website/public/downloads/`.

It prints every hash so you can verify independently. It refuses to run if no
real installer exists — it will never fabricate a feed. The committed
`website/public/updates/latest.yml` is a clearly-marked **template**; do not
serve it unchanged.

### 3. Build the static website

```bat
cd website
npm install
npm run build
```

`website/next.config.mjs` uses `output: 'export'`, so the deployable site is
**`website/out/`**. Because Next copies `public/` into `out/`, the result already
contains:

```text
website/out/updates/latest.yml
website/out/downloads/SADEEM-Setup-<version>.exe
website/out/downloads/SADEEM-<version>.zip
website/out/downloads/SHA256SUMS.txt
website/out/auth.html                 <- from website/app/auth/page.tsx
```

### 4. Deploy

Upload the **contents** of `website/out/` to the host root. Requirements:

- `https://<host>/updates/latest.yml` must return the YAML text (not an HTML
  error page). Serve `*.yml` as `text/plain` or `text/yaml`.
- `https://<host>/downloads/SADEEM-Setup-<version>.exe` must be reachable over
  HTTPS and return exactly the bytes whose hash is in `latest.yml` (no proxy
  rewriting, no compression that changes content).
- Keep the old artifact files in `/downloads/` when you publish a new version if
  you want older clients to finish downloads already in progress.
- The default feed URL in the app is `https://sadeem.app/updates/`. Change it in
  Settings → Updates (HTTPS only; `http://localhost`/`127.0.0.1`/`[::1]` allowed
  for local testing). Leaving the field empty resets to the official URL.

### 5. Verify

1. Open `https://<host>/updates/latest.yml` in a browser — real version, real
   base64 `sha512`, real `size`.
2. In the app: Settings → Updates → **Check now**. The chip moves through
   `Not checked yet → Checking… → Available · vX`, a progress bar appears while
   downloading, then **Install and restart**.
3. If a check fails, the error is shown in the UI verbatim; check HTTPS, file
   permissions, and that the YAML parses.

### 6. Code signing / SmartScreen (honest status)

Today's Windows builds are **unsigned**. `electron-updater` still installs NSIS
updates, but:

- Windows SmartScreen shows a "Windows protected your PC" warning on first run
  and on each update until the installer is signed;
- signature verification is effectively absent — integrity rests on the HTTPS
  feed and its SHA-512 hashes.

To remove the warning you need an OV/EV code-signing certificate and must
configure `electron-builder` (e.g. `win.certificateFile` / `certificatePassword`
or the `CSC_*` environment variables in your CI). That is a **separate, external
purchase + config step** — it is not part of this repository's updater code.

### 7. `SADEEM_SITE_URL` and the `/auth` dependency (separate from updates)

`electron/services/authService.ts` reads `process.env.SADEEM_SITE_URL` at
runtime via `websiteBaseUrl()`; the default is `https://sadeem.app`. It controls
the **pair-code sign-in URL**:

```text
<site>/auth.html#pair=<6-char-code>&mode=signup|signin
```

The flow: the app mints a 6-character pair code (15-minute TTL), opens that URL;
the user completes sign-in on the website; the website returns to
`sadeem://auth/callback?...` (handled in `electron/main.ts`); the pair must match
a pending code or activation fails.

**Therefore `out/auth.html` must be deployed with the site.** If you point
`SADEEM_SITE_URL` at a host that does not serve the website's auth page,
website-linked account creation/sign-in breaks — independently of whether the
update feed works. Set `SADEEM_SITE_URL` in the environment of the **desktop app
process** (staging/dev), not in the website build.

---

## العربية — نشر الإصدار القادم

### ٠. المتطلبات

- Node 18+ على Windows.
- تنفيذ `npm install` في جذر المشروع.
- مستضيف ثابت عبر HTTPS للموقع (أي CDN أو GitHub Pages أو nginx أو S3).
- **لا توجد شهادة توقيع بعد** — هذا متوقع؛ راجع الخطوة ٦.

### ١. بناء التطبيق وملفات Windows

```bat
npm run full
npm run dist:win
```

يضع `electron-builder.yml` المثبّت في `release/`:

- `release/SADEEM-Setup-<version>.exe` (مثبّت NSIS — ملف التحديث الأساسي)
- `release/SADEEM-<version>.zip` (نسخة zip، اختياري)

تأكد أن اسم الملف يحوي رقم الإصدار المطابق لـ `package.json`.

### ٢. توليد خلاصة التحديث الثابتة (لا يوجد رفع هنا)

```bat
node scripts/publish-release.mjs
```

السكربت:

١. يختار أحدث `release/SADEEM-Setup-*.exe` والـ `*.zip` الموافق؛
٢. يحسب **SHA-512 بصيغة base64** و**SHA-256 بصيغة hex** لكل ملف؛
٣. يكتب خلاصة حقيقية في `website/public/updates/latest.yml`؛
٤. ينسخ الملفات و`SHA256SUMS.txt` إلى `website/public/downloads/`.

يطبع كل التجزئات للتحقق المستقل، ويرفض العمل إن لم يجد مثبّتاً حقيقياً — لا
يخترع خلاصة أبداً. الملف الموجود في المستودع هو **قالب** موسوم بوضوح؛ لا تنشره
كما هو.

### ٣. بناء الموقع الثابت

```bat
cd website
npm install
npm run build
```

الإعداد `output: 'export'` في `website/next.config.mjs` يعني أن النسخة القابلة
للنشر هي **`website/out/`**. وبما أن Next ينسخ `public/` إلى `out/`، ستجد:

```text
website/out/updates/latest.yml
website/out/downloads/SADEEM-Setup-<version>.exe
website/out/downloads/SADEEM-<version>.zip
website/out/downloads/SHA256SUMS.txt
website/out/auth.html                 <- من website/app/auth/page.tsx
```

### ٤. النشر

ارفع **محتويات** `website/out/` إلى جذر المستضيف. الشروط:

- يجب أن يعيد `https://<host>/updates/latest.yml` نص YAML (لا صفحة خطأ HTML)؛
  قدّم `*.yml` كـ `text/plain` أو `text/yaml`.
- يجب أن يكون `https://<host>/downloads/SADEEM-Setup-<version>.exe` متاحاً عبر
  HTTPS ويعيد البايتات نفسها التي تطابق التجزئة في `latest.yml`.
- احتفظ بملفات الإصدارات القديمة في `/downloads/` عند نشر إصدار جديد حتى
  يكمل العملاء تنزيلاتهم الجارية.
- رابط الخلاصة الافتراضي في التطبيق هو `https://sadeem.app/updates/`، ويمكن
  تعديله من الإعدادات → التحديثات (HTTPS فقط؛ يُسمح بـ `http://localhost` أو
  `127.0.0.1` أو `[::1]` للاختبار المحلي). ترك الحقل فارغاً يعيد الرابط الرسمي.

### ٥. التحقق

١. افتح `https://<host>/updates/latest.yml` — إصدار حقيقي و`sha512` و`size` حقيقيان.
٢. في التطبيق: الإعدادات → التحديثات → **فحص الآن**. تتغيّر الحالة:
   `لم يُفحص بعد ← يفحص الآن… ← متاح · vX`، ثم شريط تقدّم أثناء التنزيل، ثم
   **ثبّت وأعد التشغيل**.
٣. عند الفشل يظهر الخطأ كما هو في الواجهة؛ تحقق من HTTPS والصلاحيات وصحة YAML.

### ٦. التوقيع الرقمي / SmartScreen (الوضع بصراحة)

بنيات Windows اليوم **غير موقّعة**. يستطيع `electron-updater` تثبيت تحديثات
NSIS، لكن:

- يعرض Windows SmartScreen تحذير «Windows protected your PC» عند التشغيل الأول
  ومع كل تحديث إلى أن يُوقَّع المثبّت؛
- لا يوجد تحقق توقيع فعلي — تعتمد السلامة على خلاصة HTTPS وتجزئات SHA-512.

لإزالة التحذير تحتاج شهادة توقيع OV/EV وضبط `electron-builder` (مثل
`win.certificateFile` / `certificatePassword` أو متغيرات `CSC_*` في الـ CI).
هذه **خطوة خارجية تتطلب شراءً وإعداداً منفصلين** — ليست جزءاً من كود المحدّث في
هذا المستودع.

### ٧. متغير `SADEEM_SITE_URL` والاعتماد على `/auth` (منفصل عن التحديثات)

يقرأ `electron/services/authService.ts` المتغير `process.env.SADEEM_SITE_URL`
وقت التشغيل عبر `websiteBaseUrl()`؛ الافتراضي `https://sadeem.app`. يتحكم هذا
في **رابط الاقتران لتسجيل الدخول**:

```text
<site>/auth.html#pair=<رمز-من-6-خانات>&mode=signup|signin
```

التدفق: ينشئ التطبيق رمز اقتران من ٦ خانات (صالح ١٥ دقيقة)، ويفتح الرابط؛
يُكمل المستخدم تسجيل الدخول في الموقع؛ يعود الموقع عبر
`sadeem://auth/callback?...` (تُعالَج في `electron/main.ts`)؛ ويجب أن يطابق
الرمز رمزاً قيد الانتظار وإلا فشل التنشيط.

**لذلك يجب نشر `out/auth.html` مع الموقع.** إذا وجّهت `SADEEM_SITE_URL` إلى
مستضيف لا يوفّر صفحة الموقع الخاصة بالمصادقة، سيتعطل إنشاء الحسابات وتسجيل
الدخول المرتبطان بالموقع — بغض النظر عن عمل خلاصة التحديثات. اضبط
`SADEEM_SITE_URL` في بيئة **عملية تطبيق سطح المكتب** (للاختبار/staging)، لا في
بناء الموقع.
