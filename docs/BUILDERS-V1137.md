# v11.37 — BUILDERS: كل الأدوات، ليس أداة واحدة / The whole class, not one tool

## الحكم / Blunt verdict

**قبل الإصلاح:** نداء `pdf_make` واحد بمسار حقيقي خارج مساحة العمل
(`C:\Users\acer\Music\New folder (2)\reports\cell-biology.pdf`، محتوى عربي)
كان يموت في **مُدقّق الوسائط قبل المنفّذ** برسالة `Missing required parameter: path`
أو باستثناء `PathEscapesWorkspace` غامض. النموذج كان يعيد تشكيل الوسائط
أربع مرات (`format` ثم `title` ثم تكرار) دون أن يتقدّم.

**بعد الإصلاح:** نفس النداء ينجح من **المرة الأولى** عندما يكون المسار مسموحاً
(fullAccess أو موافقة صريحة واحدة)، ويرجع **خطأً واحداً واضحاً وقابلاً للتنفيذ**
عند الرفض. لا توجد رسائل غامضة، ولا أربعة محاولات، ولا `dedupe` في هذه الطبقة
( dedupe تبقى مهمة الـ engine ).

**English:** before the fix, one valid builder call with an escaped Windows
path (spaces + parentheses, outside the workspace) and Arabic markdown died in
`validateToolArgs` / `resolveWriteInWorkspace` *before* the builder could see
it. The model reshaped args four times. Now all five builders plus
`image_generate` normalize aliases, normalize/expand the path, create parent
directories, and either write the file or return one honest, single fix line.

## الأسباب الجذرية / Root causes (exact locations)

| # | Cause | Old site | Fix site |
|---|-------|----------|----------|
| 1 | `required:['path','content']` in the defs made alias calls fail at dispatch, before any executor ran | `electron/agent/tool-defs.ts` defs at 1092 / 1505 / 1523 / 1552 / 1569 | `electron/agent/tool-defs.ts:1092`, `:1520`, `:1548`, `:1582`, `:1605` — `required: []`, aliases declared as real properties |
| 2 | `resolveWriteInWorkspace` threw `PathEscapesWorkspace` for any explicit user path | `tools.ts` builders (old 8647 / 8837 / 4415) | `tools.ts:4487` `resolveBuilderWritePath()` — fullAccess → allow, else ONE `escape` approval, else ONE actionable error |
| 3 | Only `args.path` / `args.content` / `args.format` / `args.title` were read | old executor prologues | `tools.ts:4444` alias tables + `builderArg` / `builderContent` / `builderFlag`; used by `makeDocument` (`:4894`), `pdfMake` (`:9138`), `officeMake` (`:9374`), `image_generate` (`:1644`) |
| 4 | Headless PDF fallback (minipdf, WinAnsi) turned Arabic into `?` | old `renderMiniPdf` fallback in make_document/pdf_make | `tools.ts:4720` `renderUnicodePdf()` — embeds real Cairo Arabic+Latin WOFF→TTF fonts as CIDFontType2, ToUnicode CMap, RTL glyph order; used at `:4894` and `:9138` |
| 5 | DOCX/PPTX had no RTL flags; python-docx/openpyxl absence was a dead end | old `buildDocx` / `officeMake` | `tools.ts:4222` `buildDocx(..., rtl)` → `<w:bidi/>`, `w:rtl`, Cairo font; python RTL scripts inside `officeMake`; native OOXML fallback when python modules are missing |

## ما تغيّر بالضبط / Exact changes

**`electron/agent/tools.ts`**
- `:4422` — v11.37 builder contract header (no dedupe — executor robustness only).
- `:4444` — `BUILDER_PATH_KEYS`, `BUILDER_CONTENT_KEYS`, `BUILDER_FORMAT_KEYS`, `BUILDER_TITLE_KEYS`, `BUILDER_HTML_KEYS`; `builderArg`, `builderContent`, `builderFlag`. Invisible marks (ZWSP/BOM/bidi controls) are stripped and names are NFC-normalized before use.
- `:4487` — `resolveBuilderWritePath()`: normalizes `~`, Windows/absolute/relative paths, spaces, parentheses, Arabic; fixes/appends the expected extension; auto-creates parents at write time; fullAccess or one `escape` approval permits outside writes; denial returns ONE error naming the exact fix (`reports/<file>` or fullAccess) and explicitly says "do not reshape the call".
- `:4720` — `renderUnicodePdf()`: WOFF→sfnt decoder, cmap4/cmap12 parser, CIDFontType2 + `/FontFile2` + `/ToUnicode` + `Identity-H`, RTL visual reversal, octal-escaped UTF-8 extraction copy so `pdf_read` still parses the result. Falls back to the old Latin-1 renderer **honestly** only when no font can be found.
- `:4158` — `docPrintCss(rtl)` adds `dir="rtl"`, `unicode-bidi: plaintext`, Arabic font stack; `:4894` / `:9138` set `lang="ar" dir="rtl"` on print HTML.
- `:4222` — native DOCX writer emits bidi/RTL/Cairo for Arabic.
- `:4894` `make_document`, `:9138` `pdfMake`, `:9374` `officeMake` — all route through the alias + path + Unicode/RTL helpers; pptx/docx python scripts set `rtl="1"` / `w:bidi`; missing python-docx/openpyxl degrades to the real native OOXML writer (reported in the output), never a dead end.
- `:1644` — `image_generate` uses the same path contract (aliases + one honest error) instead of throwing PathEscapesWorkspace.

**`electron/agent/tool-defs.ts`**
- `:1092` make_document, `:1520` pdf_make, `:1548` pptx_make, `:1582` docx_make, `:1605` xlsx_make — `required: []`, alias properties documented, descriptions state parent-dir auto-create, outside-path approval, and first-call alias support. Tool count stays **145**.

**`tests/v1137-builders.test.mjs`** (real executors, real bytes)
- `:94` founder-style Arabic PDF at an outside path with spaces+parentheses → one call, `%PDF-`, `/FontFile2`, `/ToUnicode`, codepoints, `pdf_read` round-trip.
- `:120` same outside path denied → ONE actionable error, exactly one `escape` decision, no file written.
- `:128` docx/pptx/xlsx with Arabic + aliases `dest/text/deck/points/savePath` → byte-verified ZIP/XLSX or one honest dependency error.
- `:178` make_document with `dest/body/fmt/name` + Arabic + unicode path with spaces/parens → byte-verified DOCX with `<w:bidi/>`.
- `:196` inside-workspace path with spaces + Arabic filename → parents auto-created, embedded-font PDF.

## التحقق / Verification (all green)

```bat
npx tsc -p tsconfig.node.json --noEmit
node --test --test-force-exit tests/v1137-builders.test.mjs
node --test --test-force-exit tests/v1126-all-tools.test.mjs
node --test --test-force-exit tests/v1134-all-tools.test.mjs
```

Results: `tsc` clean; v1137 5/5 pass; v1126 4/4 pass; v1134 6/6 pass.

## حدود صادقة / Honest limits
- `pptx_make` still requires `python-pptx`; if absent it returns ONE honest install command (no native PPTX writer exists in this layer).
- The embedded font path uses `@fontsource/cairo` (a declared dependency); if it cannot be located, the legacy Latin-1 renderer is used and the output says so — the desktop print engine remains the full-fidelity Arabic path. The headless embedder renders real Arabic glyphs in RTL order with a ToUnicode map, but does **not** perform HarfBuzz-style contextual joining; for perfectly shaped Arabic use the desktop print engine (`printToPdf`).
- Outside-workspace writes are never silently forced: fullAccess or an explicit user approval is required; otherwise the single actionable error is the correct outcome.
