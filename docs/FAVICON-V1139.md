# Favicon fix / إصلاح أيقونة التبويب — v11.13.9

## العربية

**المشكلة:** أيقونة تبويب المتصفح كانت أيقونة عامة (سهم أخضر `#98D83B`) وليست شعار سديم الحقيقي. ملفّا `favicon.png` و`sadeem-app-logo.png` كانا متطابقين (نفس الـ SHA-256) ويعرضان شكل نجمة سوداء على أخضر.

**ما تغيّر:**

- `website/app/icon.svg:1-9` — ملف جديد باتفاقية Next.js؛ يُخرج تلقائياً وسم `<link rel="icon">` الصحيح للتبويب. الشعار الحقيقي مصغَّر وقابل للقراءة: مربع داكن `#1c1b19` بحواف مستديرة + حرف S زيتوني `#A9BE56` بسماكة `4.6` (بدل `3.6` في الشعار الأصلي) ونقطتان مكبّرتان؛ حُذفت التفاصيل الدقيقة الأصغر من بكسل.
- `website/public/favicon.svg:1-9` — استُبدلت الأيقونة العامة بالشعار الحقيقي نفسه (لطلبات `/favicon.svg` المباشرة).
- `website/public/favicon.png` — أُعيد توليده (256×256) من SVG عبر `sharp`؛ كان 7,034 بايت من الأيقونة العامة الخاطئة.
- `website/app/apple-icon.png` — أيقونة لمسية جديدة iOS بحجم 180×180 من الشعار نفسه.
- `website/app/layout.tsx:166-169` — حُذف `metadata.icons`؛ تُترك الأيقونات لاتفاقيات الملفات في Next.js 16 حتى لا تتكرر وسوم `<link>`.

**التحقق:** `npx tsc --noEmit` و`npm run build` نجحا. محتوى `website/.next/server/app/index.html` يحتوي على:

```
<link rel="icon" href="/icon.svg?..." sizes="any" type="image/svg+xml"/>
<link rel="apple-touch-icon" href="/apple-icon.png?..." sizes="180x180" type="image/png"/>
```

**تنبيه:** `website/public/sadeem-app-logo.png` لا يزال الأيقونة العامة القديمة (يستخدمه رأس الموقع وبيانات OrganizationSchema)؛ وهو خارج نطاق ملفات هذه المهمة — يُنصح بتوليده من `sadeem-logo.svg` في مهمة منفصلة.

## English

**Problem:** the browser tab favicon was a generic green chevron (`#98D83B`), not the real SADEEM mark. `favicon.png` and `sadeem-app-logo.png` were byte-identical (same SHA-256) and showed a black starburst on green.

**Changes:**

- `website/app/icon.svg:1-9` — new Next.js file-convention icon; auto-emits the correct tab `<link rel="icon">`. Uses the real mark optimized for 16×16/32×32: dark `#1c1b19` rounded square + olive `#A9BE56` "S" with a widened `4.6` stroke (was `3.6`) and enlarged accent dots; the subpixel hairline frame was dropped.
- `website/public/favicon.svg:1-9` — replaced the generic chevron with the same real mark for direct `/favicon.svg` requests.
- `website/public/favicon.png` — regenerated at 256×256 from the SVG with `sharp` (previously 7,034 B of the wrong generic icon).
- `website/app/apple-icon.png` — new 180×180 iOS touch icon from the same mark.
- `website/app/layout.tsx:166-169` — removed `metadata.icons`; Next.js 16 file conventions now emit the icon links, avoiding duplicate `<link>` tags.

**Verified:** `npx tsc --noEmit` and `npm run build` both pass. Built HTML (`website/.next/server/app/index.html`) contains the `/icon.svg` and `/apple-icon.png` links shown above.

**Note:** `website/public/sadeem-app-logo.png` is still the old generic icon (used by the site header and Organization schema). It is outside this task's owned files — regenerate it from `sadeem-logo.svg` in a separate task.
