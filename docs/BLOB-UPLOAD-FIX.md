# Vercel Blob upload fix / إصلاح رفع الملفات على Vercel Blob

**Status / الحالة: ✅ FIXED — both artifacts uploaded AND byte-verified (2026-11-20 ~05:36 UTC).**

---

## English

### What was wrong
`website/lib/site.ts` advertises two SHA-256 hashes for the v11.12.0 installers, but the
public Blob URLs served stale/missing files. The upload had failed with:

```
Error: Vercel Blob: Access denied, please provide a valid token for this resource.
```

Cause: the `VERCEL_OIDC_TOKEN` values saved in `website/.env.local` and
`website/.env.vercel.local` were **expired** (short-lived, ~12 h). There is no
`BLOB_READ_WRITE_TOKEN` on this machine. The earlier `npx vercel whoami` produced no
output, which misleadingly suggested there was no CLI login.

### What actually worked
The Vercel CLI **was** authenticated as user/team `wasdrty78-1373s-projects`
(`npx vercel whoami` → `wasdrty78-1373s-projects`, exit 0). Because of that, a fresh
OIDC token could be pulled — no dashboard token was needed:

```powershell
cd "D:\New folder (58)\SADEEM-v11.12.0-source\src-pkg-v1112\sadeem-v11.12.0\website"

# 1) Refresh the short-lived OIDC token (CLI is already logged in)
npx --yes vercel@latest env pull .env.oidc.tmp --environment=development --yes

# 2) Upload both artifacts to the SAME pathnames, public, overwrite
npx --yes vercel@latest blob put "..\release\SADEEM-Setup-11.12.0.exe" `
  --pathname "sadeem/SADEEM-Setup-11.12.0.exe" --access public --force `
  --oidc-token $OIDC --store $STORE
npx --yes vercel@latest blob put "..\release\SADEEM-11.12.0-win.zip" `
  --pathname "sadeem/SADEEM-11.12.0-win.zip" --access public --force `
  --oidc-token $OIDC --store $STORE

# ($OIDC = VERCEL_OIDC_TOKEN and $STORE = BLOB_STORE_ID read from .env.oidc.tmp)
```

Both uploads returned `Success!` with exit code 0.

### Verification (GET the live URLs, hash the downloaded bytes)
| Artifact | HTTP | Bytes | SHA-256 downloaded | Expected | Match |
|---|---|---|---|---|---|
| `SADEEM-Setup-11.12.0.exe` | 200 | 113,101,139 | `258a5fbbb44b94fbfd519cc116a780050ec8dc6fbd7b30bfaccacf335a1aca00` | same | ✅ |
| `SADEEM-11.12.0-win.zip` | 200 | 150,951,433 | `f7f5d5cdd1fc00fedfdd72f454f7c74958f53fc6541fa4f6a6a023913a86b7d7` | same | ✅ |

The local files in `release/` were also hashed first and matched the same two values, so
the hashes in `website/lib/site.ts` are honest and the hosted bytes are identical.

### Current state
- ✅ Both files are live at the URLs in `website/lib/site.ts` with **public** access.
- ✅ Fresh OIDC token written into `website/.env.local` and `website/.env.vercel.local`.
- ⚠️ OIDC tokens expire in ~12 h. After expiry, re-run the refresh+upload (below).
- ❌ No `BLOB_READ_WRITE_TOKEN` exists on this machine; not needed while CLI login works.

### One-command repeat / CI
From the repository root:

```powershell
node scripts/upload-blobs.mjs
```

`scripts/upload-blobs.mjs` reads the URLs and hashes from `website/lib/site.ts`, refreshes
the OIDC token via `vercel env pull` if expired, uploads both files, downloads them again,
and exits non-zero if any hash does not match. It prints no secrets.

### Exact Vercel identifiers (for the dashboard, 1-minute fix)
- Team / owner: **`wasdrty78-1373s-projects`** — `team_4Aan9DJm4IsSvdTMIH7rYZel`
- Website project: **`sadeem-website`** — `prj_hg5tJqmbSnCTfjYoc1EpnPfG49wN`
  (linked in `website/.vercel/project.json`)
- Blob store: **`store_LVwKLW93yZeWUTw4`** → `lvwklw93yzewutw4.public.blob.vercel-storage.com`
- Separate root project (Electron app, not the Blob store): `sadeem-v11.12.0` — `prj_OJJqLUkNjKq57JEDbeMR9qnuYfrr`

To fix in the dashboard: open the **sadeem-website** project → **Storage** → the Blob store →
create a **Read/Write token** and set `BLOB_READ_WRITE_TOKEN` as a project env var if you
prefer a non-expiring CI credential. This is optional — the CLI-login + OIDC path worked.

### If it ever fails again
1. `npx vercel login` (re-authenticate the CLI).
2. `node scripts/upload-blobs.mjs` (or the manual commands above).
3. Re-run the GET+hash check. Never claim success without a matching hash.

---

## العربية

### ما الخطأ الذي حدث
كان ملف `website/lib/site.ts` يعرض قيمتي SHA-256 لمثبّتي الإصدار 11.12.0، لكن روابط Blob
العامة كانت تعرض ملفات قديمة/غير موجودة. فشل الرفع بالرسالة:

```
Error: Vercel Blob: Access denied, please provide a valid token for this resource.
```

السبب: رموز `VERCEL_OIDC_TOKEN` المحفوظة في `website/.env.local` و `website/.env.vercel.local`
كانت **منتهية الصلاحية** (صالحة حوالي 12 ساعة فقط). لا يوجد `BLOB_READ_WRITE_TOKEN` على هذا
الجهاز. وأعطى `npx vercel whoami` نتيجة فارغة سابقاً، مما أوحى زوراً بعدم وجود تسجيل دخول.

### ما نجح فعلاً
أداة Vercel CLI **كانت** مسجّلة الدخول باسم `wasdrty78-1373s-projects`
(`npx vercel whoami` أعاد الاسم مع رمز خروج 0). لذلك أمكن سحب رمز OIDC جديد دون الحاجة إلى
رمز من لوحة التحكم. تم رفع الملفين إلى **نفس المسارات** بصلاحية `public` مع `--force`.

### التحقق (تنزيل الروابط الحيّة ومقارنة البصمة)
| الملف | HTTP | الحجم | SHA-256 للملف المُنزّل | المتوقع | مطابق |
|---|---|---|---|---|---|
| `SADEEM-Setup-11.12.0.exe` | 200 | 113,101,139 | `258a5fbbb44b94fbfd519cc116a780050ec8dc6fbd7b30bfaccacf335a1aca00` | نفسه | ✅ |
| `SADEEM-11.12.0-win.zip` | 200 | 150,951,433 | `f7f5d5cdd1fc00fedfdd72f454f7c74958f53fc6541fa4f6a6a023913a86b7d7` | نفسه | ✅ |

تم أيضاً حساب بصمة الملفين المحليين في `release/` فطابقت القيمتين نفسهما، أي أن الأرقام
المذكورة في الموقع صادقة والبايتات المستضافة مطابقة تماماً.

### الحالة الحالية
- ✅ الملفان متاحان الآن على روابط `website/lib/site.ts` بصلاحية عامة.
- ✅ تم تحديث رمز OIDC في `website/.env.local` و `website/.env.vercel.local`.
- ⚠️ رمز OIDC ينتهي بعد ~12 ساعة؛ أعد الأمر أدناه بعد انتهائه.
- ❌ لا يوجد `BLOB_READ_WRITE_TOKEN` على الجهاز، لكنه غير مطلوب طالما أن تسجيل الدخول يعمل.

### أمر واحد لإعادة الرفع
من جذر المشروع:

```powershell
node scripts/upload-blobs.mjs
```

يقرأ السكربت الروابط والبصمات من `website/lib/site.ts`، ويجدّد الرمز عند انتهائه، ويرفع
الملفين، ثم ينزّلهما ويقارن البصمات، ويخرج برمز خطأ عند أي عدم تطابق، دون إظهار أي أسرار.

### معرّفات Vercel الدقيقة (للوحة التحكم)
- الفريق: **`wasdrty78-1373s-projects`** — `team_4Aan9DJm4IsSvdTMIH7rYZel`
- مشروع الموقع: **`sadeem-website`** — `prj_hg5tJqmbSnCTfjYoc1EpnPfG49wN`
- مخزن Blob: **`store_LVwKLW93yZeWUTw4`** → `lvwklw93yzewutw4.public.blob.vercel-storage.com`

لإصلاح دائم من اللوحة: افتح مشروع **sadeem-website** ← **Storage** ← مخزن Blob ← أنشئ
**Read/Write token** وضعه في `BLOB_READ_WRITE_TOKEN` كمتغير بيئة للمشروع. هذا اختياري؛
طريقة CLI + OIDC نجحت بالفعل.

### إذا فشل الأمر مجدداً
1. `npx vercel login` (أعد تسجيل الدخول).
2. `node scripts/upload-blobs.mjs`.
3. أعد فحص التنزيل والبصمة. لا تدّع النجاح دون تطابق البصمة.
