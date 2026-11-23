# IMAGE DISPLAY — V11.34 VERIFICATION GUARD (`tests/v1134-image-guard.test.mjs`)

> Scope: **diagnosis + guard only.** No app source was changed by this task.
> The guard performs **real SSR of the actual bundled `MessageView`** (esbuild
> bundle of the real `.tsx`, real zustand store seeded with the message +
> tool result, `react-dom/server`) — not a source-text-only check.

---

## 1. الحكم الصريح / Blunt verdict

**EN —** The founder's literal complaint **"كود وأرقام بدل الصورة" DOES NOT reproduce any more for the payload shapes the engine actually emits.** A real `<img>` is rendered for: a JSON tool result `{ok:true, dataUrl:…}`, an `images: ["data:image/png;base64,…"]` string array, and the `Image generated → …png (WxH, KB)` text line. No base64, no JSON and no `<pre>` reaches visible text in those cases.

**BUT the guard is RED (2 failures) against the exact acceptance seeds you specified:**

1. **`images:[{dataUrl:'data:image/png;base64,…'}]` (object items) is ignored.** The data URL is dropped. V1 falls back to the text path and renders `<img src="C:\sadeem\out\foo.png">` — a file path, not the requested picture. The literal "code and numbers" text is gone, but the **image itself is not the one you seeded**; in a renderer a bare `C:\…` path is not a loadable image `src`, so the user can still end up staring at a broken-image glyph instead of a picture.
2. **The image affordance is not bilingual.** `mv.img.open` is an inline English-only fallback and has no dictionary entry, so the Arabic UI keeps the English "Open full size" label on the thumbnail/lightbox.

**AR —** الشكوى الحرفية للمؤسس **«يطلع كود وأرقام بدل الصورة» لم تعد تتكرر** في الأشكال الحقيقية اللي يطلعها المحرّك (JSON فيه `dataUrl`، مصفوفة `images` نصوص، أو سطر `Image generated → …`). صار فيه `<img>` حقيقي وما فيه base64 ولا JSON داخل `<pre>`.

**لكن الحارس أحمر (فشلان) مقابل بذور الاختبار اللي طلبتها بالضبط:**

1. **`images:[{dataUrl:…}]` (عناصر كائن) تتجاهَل.** الـ data URL يضيع، و V1 يرجع لمسار النص ويرسم `<img src="C:\...\foo.png">` — مسار ملف مو الصورة المطلوبة. النص «كود وأرقام» اختفى، بس **الصورة مو الصورة اللي زرعتها**، والمسار الخام غالباً ما بيتحمّل كصورة داخل الواجهة.
2. **عنوان الصورة مو ثنائي اللغة.** `mv.img.open` fallback إنجليزي فقط وما له مدخل في القاموس، فالواجهة العربية بتظهر "Open full size" بالإنجليزي على المصغّرة/العرض الكامل.

---

## 2. ما اللي انفذ فعلياً / What was actually executed

```
node --test --test-force-exit tests/v1134-image-guard.test.mjs
```

Harness (same posture as `v1111-providers-context.test.mjs`):
- `tests/fixtures/v1134-render-entry.ts` → esbuild CJS bundle exporting the **real** `useStore` + `MessageView`.
- electron stub + tmp-only zustand SSR patch (`setServerInitialState`) so the seeded store — not zustand's creation-time snapshot — is what the server renderer sees.
- `react-dom/server.renderToStaticMarkup` on the real memoized `MessageView`.
- Seeds: `tool_call(image_generate)` + `tool_result` with `{ images:[{dataUrl}] }`, and a path-only text result `Image generated → C:\sadeem\out\bar.png (512x512, 41KB)`.
- Rendered in both `en` and `ar` locales.

Result at verification time: **6 tests — 4 pass, 2 fail.**

| # | Test | Result |
|---|------|--------|
| 0 | harness: real bundle + seeded store + SSR | ✅ PASS |
| 1 | `images:[{dataUrl}]` → `<img src=dataUrl>`, no base64 text, no `<pre>` | ❌ **FAIL** |
| 2 | path text result → thumbnail/glyph + real caption, not a text dump | ✅ PASS |
| 3a | source-level click-to-open handler on the image result | ✅ PASS |
| 3b | caption bilingual + single-language + no raw JSON | ❌ **FAIL** |
| 4 | hairline-only image CSS, reduced-motion guarded | ✅ PASS |

---

## 3. الفشل مع المواقع / FAILURES (file:line — do not fix source here)

### F1 — object-shaped `images` are silently skipped  (`V1134-1`)

- **Cause:** `src/components/MessageView.tsx:1865` — `if (typeof s !== 'string') continue;` inside `imageItemsOf()`. An image object `{dataUrl}` is not a string, so it never becomes an `ImageResultItem`.
- **Type contract:** `shared/types.ts:126` — `images?: string[];` (the object shape is not modelled).
- **Same skip for JSON-array branch:** `src/components/MessageView.tsx:1887`.
- **Observed SSR markup** for the seeded result:
  ```html
  <img class="sc18-imgres-thumb" src="C:\sadeem\out\foo.png" alt="foo.png" …/>
  ```
  Visible text: `CREATE foo.png OK 100ms foo.png · 1024×1024 · 83KB …` — no base64, no `<pre>`, but **not the seeded data URL**.
- **Fix belongs in V1 source** (parent's call): teach `imageItemsOf` to unwrap `{dataUrl}` (and update `shared/types.ts`), or confirm the acceptance seed should be `images: ["data:image/png;base64,…"]`.

### F2 — no Arabic variant for the image open label  (`V1134-3b`)

- **Cause:** `src/components/MessageView.tsx:1940` (and `:1941`) use `t('mv.img.open', 'Open full size')`.
- `mv.img.open` has **no entry** in `src/i18n.ts` dictionary (unlike `common.close` at `i18n.ts:595`, which has `['Close','إغلاق']`). In `ar` locale the fallback stays English. The visible caption itself is language-neutral data (`foo.png · 1024×1024 · 83KB`) — that part is correctly single-language and JSON-free; the bilingual gap is the affordance label.
- **Fix belongs in V1 source:** add `'mv.img.open': ['Open full size', 'افتح بالحجم الكامل']` to `i18n.ts` (or use an existing bilingual key).

---

## 4. اللي نجح / What passes (evidence V1 is mostly right)

- **Real SSR produces a bitmap, not a dump.** `ResultRow` (`MessageView.tsx:1989`, branch at `:2033`) routes detected images to `ImageResultGallery` (`:1923`); the `<pre>` dump only remains for non-image payloads (`:2038`). `imageItemsOf` (`:1856`) correctly parses: JSON `{ok,dataUrl,path,width,height,bytes}`, JSON `images:[…]`, string `images:[…]`, and the regex `Image generated → file (WxH, KB)` at `:1897`.
- **Click-to-open exists (source-level):** `onClick={() => setOpen(i)}` at `MessageView.tsx:1939` opens the lightbox (`:1955`) with Escape/backdrop/close handlers (`:1926-1931`, `:1961`).
- **Caption is honest data:** `imageCaption` (`:1912`) emits `filename · WxH · KB` — no raw JSON, no base64, no EN+AR mix. Test 2 confirmed no `→` path line and no `<pre>` text dump for the path-only result.
- **No boxy card:** image rules `chat-final.css:753-850` use 1px hairlines only; no `box-shadow`. Reduced-motion is guarded by `@media (prefers-reduced-motion: reduce)` and `html.reduce-motion` (`:852`, `:854`).

---

## 5. كيف تعيد الفحص / Re-run & debug

```powershell
cd "D:\New folder (58)\SADEEM-v11.12.0-source\src-pkg-v1112\sadeem-v11.12.0"
node --test --test-force-exit tests/v1134-image-guard.test.mjs
# optional: print the actual <img> tags + visible text for failure F1
$env:V1134_DEBUG='1'; node --test --test-force-exit tests/v1134-image-guard.test.mjs
```

The guard fails (non-zero exit) while F1/F2 are present. It must go **green (6/6)** before the image fix can be called done. The two failing assertions carry `file:line` in their messages so the parent can route them to the right source line without guessing.

---

## 6. ملاحظة توقيتية / Timing note

V1 source (`MessageView.tsx`, `chat-final.css`) was being edited concurrently while this guard was being authored; the numbers above are from the state present at verification time. The guard is implementation-agnostic about exact class names where possible, but it keys on `ImageResultGallery` / `mv.img.open` because those are the V1 hooks currently in the file. If V1 renames them, update the anchors in the guard rather than weakening the assertions.
