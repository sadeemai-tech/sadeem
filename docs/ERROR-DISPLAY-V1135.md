# v11.35 — Calm APP-error display

## English

### The complaint

> "Improve how APP errors are displayed — not the AI's text errors, the
> application errors: the provider, the rate limit. Show it clearer, prettier,
> better."

### Before

Every system failure arrived at the transcript as a `model: 'error'` row and
was rendered by one branch in `src/components/MessageView.tsx` (old line
3250):

```tsx
<div className="w-full error-card p-3 flex items-start gap-2 anim-in msg-in">
  <AlertTriangle size={14} className="text-bad shrink-0 mt-0.5" />
  <div className="text-[14.5px] whitespace-pre-wrap break-words select-text min-w-0" dir="auto">
    {msg.content}
  </div>
</div>
```

`.error-card` (`src/components/chat.css:343`) is a tinted, shadowed, rounded
red-ish box. The entire localized (or raw provider) string was dumped verbatim
into it: no classification, no short title, no reason code, no next step. A
429, a 402, a 503 and a dead network all looked identical — a loud box with a
wall of text. The assistant's own prose was unaffected; only SYSTEM errors
used this path.

### After

The branch now calls the new instrument (`MessageView.tsx:3253–3257`):

```tsx
<ErrorNotice content={msg.content} onRetry={canRetry ? onRetry : undefined} />
```

`src/components/ErrorNotice.tsx:201` renders, in one quiet column behind a
single 1px inline-start hairline:

1. **A 1px glyph** — an interrupted 270° orbit on a 24×24 grid, a small cross
   in the break, a registration stem; pure `currentColor`, no fill, no badge.
2. **A short human title** — "Rate limit reached" / "Credits exhausted" /
   "Provider unavailable" / "Connection lost" / "API key needs attention" /
   "Couldn't complete the request" — in Instrument Serif (Cairo in RTL).
3. **The REAL reason** — a neutral tabular-mono machine token extracted from
   the payload (`429`, `402`, `503`, `ENOTFOUND`, `NO_MODEL`, …), plus one
   honest reason sentence. Classification is pure and exported
   (`classifyError` at `ErrorNotice.tsx:42`, `machineCodeOf` at `:61`).
4. **A concrete next step** — wait & retry / add credits / switch provider /
   check the connection / check the API key.
5. **A real retry action** — mounted ONLY when ChatPanel supplied a handler;
   the captured JSX `onClick` is invoked in the SSR suite. No handler ⇒ no
   phantom button.
6. **An optional, collapsed "Details"** — the original localized message is
   never in the first paint; raw JSON is dropped, and a wrong-language detail
   is refused, so the surface is always single-language.

Design contract (`src/components/error-display.css:16–188`): hairlines only,
no fill/shadow/gradient/boxy radius, unchanged palette tokens, logical
properties (`padding-inline-start`, `inset-inline-start`, `border-inline-start`),
`font-variant-numeric: tabular-nums` for codes, and BOTH reduced-motion gates
(`@media (prefers-reduced-motion: reduce)` and `html.reduce-motion`).

### Error paths found during the audit

| Path | What it is | Ownership / state |
|---|---|---|
| `src/components/MessageView.tsx:3253` | system `model:'error'` transcript row | **fixed here** |
| `src/components/MessageView.tsx:2666–2688` | `ERROR` / `DENIED` tool status pill | tool grammar — left untouched |
| `src/components/MessageView.tsx:2959–2977` | failed tool-result tint (`.is-error`) | tool grammar — left untouched |
| `src/components/Toasts.tsx:82–139` | severity toast (`toast-error`, edge bar) | separate surface — untouched |
| `src/components/SurfaceErrorBoundary.tsx:41–80` | crash fallback — **hard-coded `const ar = true`, bilingual + raw `error.message`** | reported to parent; not in this agent's ownership |
| `src/store.ts:193–284`, `:4838` | `runErrorKey` / `localizeRunError` already produce one-language text | parent-owned — untouched |

### i18n keys the PARENT must add to `src/i18n.ts`

Every label already calls `t(key, 'English fallback')`
(`ErrorNotice.tsx:183–191`). Until the bundle contains these keys, EN renders
the fallback verbatim and AR uses a local Arabic string, so no locale ever
shows mixed English+Arabic. Add exactly these `[en, ar]` pairs — the English
strings MUST match the fallbacks verbatim (the SSR suite asserts them):

```ts
'err.display.eyebrow': ['APP ERROR', 'خطأ التطبيق'],
'err.display.retry': ['Retry', 'إعادة المحاولة'],
'err.display.details': ['Details', 'التفاصيل'],
'err.display.detailsHide': ['Hide details', 'إخفاء التفاصيل'],

'err.display.title.rateLimit': ['Rate limit reached', 'تم بلوغ حد الطلبات'],
'err.display.reason.rateLimit': ['The provider is limiting requests right now.', 'المزوّد يحدّد الطلبات حالياً.'],
'err.display.next.rateLimit': ['Wait a moment, then retry — or switch models.', 'انتظر قليلاً ثم أعد المحاولة — أو بدّل النموذج.'],

'err.display.title.quota': ['Credits exhausted', 'الرصيد مستنفد'],
'err.display.reason.quota': ['The provider account has no credits left.', 'حساب المزوّد ليس لديه رصيد متبقٍ.'],
'err.display.next.quota': ['Add credits or switch provider/key in Settings → AI providers.', 'أضف رصيداً أو بدّل المزوّد/المفتاح من الإعدادات ← مزودو الذكاء الاصطناعي.'],

'err.display.title.provider': ['Provider unavailable', 'المزوّد غير متاح'],
'err.display.reason.provider': ['The provider did not answer this request.', 'المزوّد لم يجب على هذا الطلب.'],
'err.display.next.provider': ['Check the connection, then retry or switch provider.', 'تحقق من الاتصال، ثم أعد المحاولة أو بدّل المزوّد.'],

'err.display.title.network': ['Connection lost', 'انقطع الاتصال'],
'err.display.reason.network': ['The request never reached the provider.', 'لم يصل الطلب إلى المزوّد.'],
'err.display.next.network': ['Check your connection, then retry.', 'تحقق من اتصالك، ثم أعد المحاولة.'],

'err.display.title.auth': ['API key needs attention', 'مفتاح API يحتاج تحققاً'],
'err.display.reason.auth': ['The provider rejected the credentials.', 'المزوّد رفض بيانات الاعتماد.'],
'err.display.next.auth': ['Check your API key in Settings → AI providers.', 'تحقق من مفتاح API في الإعدادات ← مزودو الذكاء الاصطناعي.'],

'err.display.title.generic': ["Couldn't complete the request", 'تعذّر إكمال الطلب'],
'err.display.reason.generic': ['The request stopped before an answer arrived.', 'توقّف الطلب قبل وصول الإجابة.'],
'err.display.next.generic': ['Retry, or check the provider settings.', 'أعد المحاولة، أو تحقق من إعدادات المزوّد.'],
```

### Verification

- `npx tsc --noEmit` — clean.
- `node --test --test-force-exit tests/v1135-error-display.test.mjs` — 15/15 green
  (classification, machine code, JSON sanitizer, 429 SSR, single-language EN+AR,
  real retry `onClick`, no boxy card, CSS contract).
- `tests/v1127-ui-guard.test.mjs` — 27/27 green.
- `tests/v1116-chat-precision.test.mjs` — green (same run).
- `tests/v1134-image-display.test.mjs` + `v1134-image-guard.test.mjs` — 18/18
  green (the other agent's image/gallery code is untouched).

---

## العربية

### الشكوى

> "بدّل طريقة عرض أخطاء التطبيق — مش أخطاء الذكاء الاصطناعي: البروفايدر،
> الريت ليميتنج… اعرضها أوضح وأجمل وأفضل."

### قبل

كانت أخطاء النظام تصل إلى المحادثة كرسالة `model: 'error'` وتُعرض في
`MessageView.tsx` داخل صندوق `.error-card` ملوّن بحدود وظل وحروف دائرية،
مع نص خام كامل بلا تصنيف ولا سبب ولا خطوة تالية. 429 و402 و503 وانقطاع
الشبكة كلها تبدو متطابقة: صندوق صاخب فيه جدار نص.

### بعد

أصبح فرع الأخطاء يستدعي أداة هادئة (`MessageView.tsx:3253`):

- خط شعري واحد بطول 1px على حافة البداية المنطقية، بلا صندوق ولا خلفية.
- رمز 1px لمدار مقطوع، بلا حشو ولا وسام.
- عنوان إنساني قصير بخط Instrument Serif (Cairo في RTL).
- **السبب الحقيقي**: رمز آلي بخط mono ذو أرقام ثابتة (`429`, `402`, `503`,
  `ENOTFOUND`…) مع جملة سبب صادقة.
- خطوة تالية محددة (انتظار/إعادة محاولة، إضافة رصيد، تبديل مزوّد، فحص المفتاح).
- زر إعادة محاولة **فقط** عند وجود معالج حقيقي من ChatPanel.
- تفاصيل مخفية افتراضياً؛ JSON الخام لا يُعرض إطلاقاً، واللغة الخاطئة تُرفض
  لتبقى اللغة واحدة في كل عرض.

### مفاتيح الترجمة المطلوبة من الأب

أضف الأزواج `[en, ar]` المذكورة أعلاه في `src/i18n.ts`. إلى حين إضافتها،
يعرض الإنجليزي النص الاحتياطي ويستخدم العربي نموذجاً عربياً محلياً — ولا
يختلط لسان في الواجهة. `SurfaceErrorBoundary.tsx:41` لا يزال يعرض نصاً
ثنائي اللغة ورسالة خطأ خاماً؛ أُبلغ عنه لأنه خارج نطاق هذا الملف.

### التحقق

`tsc --noEmit` نظيف، والاختبارات `v1135-error-display` (15/15)،
`v1127-ui-guard` (27/27)، `v1116-chat-precision`، و`v1134-image-*`
(18/18) كلها ناجحة.
