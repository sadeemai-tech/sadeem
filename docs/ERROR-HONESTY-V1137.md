# v11.37 — Error honesty: the false 429

## English

### Blunt verdict

**Does the false 429 still appear? NO — not from an assistant answer, and not
from a stale/leaked `model:'error'` tag on an answer-shaped row. The turn now
shows the reply and nothing else.** The calm card still appears for a REAL
failure with a real machine reason (429 / 402 / 503 / …) — that is deliberate
and honest.

**One honest caveat:** if an *upstream* layer writes a genuine `error`-shaped
429 string into a `model:'error'` transcript row (a leaked internal `error`
event), my rendering layer cannot know the run later succeeded — it shows the
card. That root cause is outside my three files; exact handoff below.

### The cause, with file:line

1. `src/components/MessageView.tsx:3222` (before) gated the card on ONE weak
   signal: `const isError = msg.model === 'error';`. Any row carrying that tag —
   a stale row from an old persisted session, or a row written from a leaked
   `error` event — became an error card regardless of what its text actually
   was.
2. `src/components/ErrorNotice.tsx:37` classified with
   `/rate.?limit|too many requests|\b429\b|…/i`. Any text containing "429" or
   "rate limit", **including ordinary assistant prose**, became
   `data-kind="rateLimit"` → "Rate limit reached". So a successful answer that
   merely *mentioned* the rate limit was rendered as an app failure.
3. The upstream row writer that can put such a tag on a transcript row is
   `electron/services/apiServerService.ts:1362–1373` (`case 'error'` pushes
   `{ role:'assistant', kind:'text', content: e.message, model:'error' }` for
   **every** error event, including a recoverable internal 429). The renderer's
   own `src/store.ts` `case 'error'` (`:4903`) does NOT push such a row, so the
   desktop chat path is clean; the headless/phone bridge path is the leak.

### Fix (only my three owned files)

- `src/components/ErrorNotice.tsx:77` — new pure `isAssistantProse(raw)`:
  recognizes conversational answer openings and success claims ("I retried …
  it worked", "You can retry …", success phrases) and refuses to treat them as
  a machine failure. Structured JSON is never "prose".
- `src/components/ErrorNotice.tsx:96` — new pure `isGenuineAppError(msg)`: the
  single strict gate. Requires `isError === true` / `role === 'error'` (or the
  legacy `model === 'error'` tag), rejects streaming rows, and rejects any
  answer-shaped payload even if a stale/leaked tag says "error".
- `src/components/ErrorNotice.tsx:107–115` — `classifyError` now returns
  `generic` for assistant prose; it can no longer label prose a rate limit. A
  real `Rate limited (429)…` sentence still classifies `rateLimit`.
- `src/components/MessageView.tsx:86,3226` — the error branch now uses
  `isGenuineAppError(msg)` instead of the raw tag. Image/gallery and tool rows
  were not touched.
- `src/components/error-display.css` — unchanged (already hairline-only,
  RTL-safe, both reduced-motion gates). No visual regression.

### Handoffs to the parent (out of my scope — do not edit from this agent)

| # | file:line | issue | suggested fix |
|---|---|---|---|
| H1 | `electron/services/apiServerService.ts:1362–1373` | Every `error` event becomes a `model:'error'` transcript row. A recoverable internal 429 that is later retried successfully leaves a stale error row next to the good answer. | Only append the row for a **terminal** error (no later `message_end`/`task_report` with outcome `completed`), or drop the row when a later assistant answer exists; mirror the renderer's `runReport.final` guard. |
| H2 | `electron/agent/providers.ts:950–957`, `:1230–1250` and `electron/agent/engine.ts:1870,4751,5905` | Sources of `error` events; verify a 429 that is recovered in place never reaches `sendError`. | Keep the quiet-notice path (already present) as the only 429 surface; never emit a terminal `error` for an internally retried call. |
| H3 | `src/components/EffortControl.tsx:126` | Was: `aria-haspopup="slider"` broke `tsc --noEmit` (pre-existing, unrelated to v1137). **Resolved concurrently by another agent** — `tsc --noEmit` is now clean. | None. |
| H4 | `src/store.ts:3569,3645` | `/review` and `/commit` still write raw `model:'error'` rows with prose content; they still render (no explicit `isError`). | Add `isError: true` to those rows so the explicit marker is authoritative. |
| i18n | — | **No new i18n keys** in v1137. The v1135 `err.display.*` keys remain parent-owned (fallbacks are single-language). | Nothing to add. |

### Verification

- `tests/v1137-error-honesty.test.mjs` — **8/8 green** (real esbuild bundle +
  `react-dom/server` + real store): EN/AR normal answers mentioning 429 render
  NO card; a stale/leaked tag on an answer-shaped row renders NO card; a real
  `isError` 429 renders the calm card in one language with no raw JSON; pure
  classifier/gate assertions; source guard.
- `tests/v1135-error-display.test.mjs` — 15/15 green.
- `tests/v1123-error-audit.test.mjs` — 12/12 green.
- `tests/v1134-image-guard.test.mjs` — 6/6 green (image/gallery untouched).
- `npx tsc --noEmit` — **clean** (the unrelated `EffortControl.tsx:126` error was
  fixed concurrently by another agent; no v1137 file ever failed it).

---

## العربية

### الحكم بوضوح

**هل يظهر خطأ 429 الخاطئ بعد الإصلاح؟ لا — لا من إجابة المساعد، ولا من وسم
`model:'error'` قديم/متسرّب على صف تشبه إجابة. الدورة تُظهر الرد فقط.** بطاقة
الخطأ الهادئة تظل تظهر لفشل حقيقي بسبب آلي حقيقي (429 / 402 / 503…) — هذا
مقصود وصادق.

**تحذير صادق:** إذا كتبت طبقة *أعلى* نص خطأ 429 صحيح الشكل في صف `model:'error'`
(حدث `error` متسرّب)، فإن طبقة العرض لا تستطيع معرفة أن الدورة نجحت لاحقاً —
فتُظهر البطاقة. السبب الجذري خارج ملفاتي الثلاثة؛ التفاصيل أدناه.

### السبب بمواقع الأسطر

1. `src/components/MessageView.tsx:3222` (قبل) كان يعتمد على إشارة واحدة ضعيفة:
   `const isError = msg.model === 'error';`. أي صف يحمل الوسم — صف قديم من جلسة
   محفوظة أو صف كُتب من حدث `error` متسرّب — يتحول إلى بطاقة خطأ مهما كان نصه.
2. `src/components/ErrorNotice.tsx:37` كان يصنّف بـ
   `/rate.?limit|too many requests|\b429\b|…/i`، فأي نص فيه "429" أو "rate
   limit" — **بما فيه كلام المساعد العادي** — يصير `rateLimit` → "تم بلوغ حد
   الطلبات". فإجابة ناجحة ذكرت الريت ليميت فقط تُعرض كخطأ تطبيق.
3. كاتب الصف في الأعلى: `electron/services/apiServerService.ts:1362–1373`
   (`case 'error'`) يضيف صف `model:'error'` لكل حدث error، بما فيه 429 قابل
   للاستعادة. متجر العارض `src/store.ts:4903` لا يفعل ذلك، لذا مسار الدردشة
   على سطح المكتب نظيف؛ التسريب في مسار الـ bridge (الهاتف/headless).

### الإصلاح (ملفاتي الثلاثة فقط)

- `ErrorNotice.tsx:77` — دالة `isAssistantProse` ترفض اعتبار كلام الإجابة
  ("أعدت المحاولة ونجح…"، "يمكنك إعادة المحاولة…") فشلاً آلياً.
- `ErrorNotice.tsx:96` — دالة `isGenuineAppError`: البوابة الوحيدة الصارمة؛
  ترفض الصفوف الحيّة والصفوف ذات شكل الإجابة حتى لو كان الوسم قديم/متسرّب.
- `ErrorNotice.tsx:107–115` — `classifyError` لا يصنّف كلام المساعد كخطأ؛
  رسالة `Rate limited (429)…` الحقيقية تظل `rateLimit`.
- `MessageView.tsx:86,3226` — فرع الخطأ يستخدم `isGenuineAppError(msg)`.
  كود الصور والمعرض وأدوات لم يُمسّ.
- `error-display.css` — بلا تغيير (شعرة واحدة، RTL، حاجزا الحركة).

### تسليمات للأب (خارج نطاقي)

| # | file:line | المشكلة |
|---|---|---|
| H1 | `electron/services/apiServerService.ts:1362–1373` | حدث error متسرّب يترك صف خطأ قديم بجانب إجابة ناجحة — أضف شرط نهائية الدورة. |
| H2 | `electron/agent/providers.ts:950–957,1230–1250` و`engine.ts:1870,4751,5905` | تأكد أن 429 المستعادة داخلياً لا تصل إلى `sendError`. |
| H3 | `src/components/EffortControl.tsx:126` | كان `aria-haspopup="slider"` يفشل `tsc --noEmit` — أُصلح بالتوازي من عميل آخر؛ الفحص نظيف الآن. |
| H4 | `src/store.ts:3569,3645` | صفوف `/review` و`/commit` تحتاج `isError: true` صريحاً. |
| i18n | — | **لا مفاتيح جديدة** في v1137. مفاتيح v1135 `err.display.*` مسؤولية الأب. |

### التحقق

- `v1137-error-honesty` — 8/8 أخضر.
- `v1135-error-display` — 15/15 · `v1123-error-audit` — 12/12 ·
  `v1134-image-guard` — 6/6.
- `tsc --noEmit` — نظيف (الخطأ السابق في `EffortControl.tsx:126` أُصلح بالتوازي، H3).
