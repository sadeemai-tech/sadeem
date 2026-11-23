# DOWNLOAD REWRITE — v11.44 (Q7)

**Scope:** `website/app/download/page.tsx` and `website/components/download/DownloadPage.tsx` only.
No CSS, no `site.ts`, no ChunkedDownload logic, no layout, no other page was edited.

**References used:** `docs/FEATURE-TRUTH-V1144.md` §13 (internal-never-publish inventory),
`docs/DOCS-STYLE-V1144.md` (Rules 1, 2, 3, 5, 6, 8, 9), and the founder's instruction:
「بصفحة الداونلود كاتب لي بيانات حقيقية… الداونلود شو الابديت حيكون مانيوال ولا هاي… معلومات داخلية ما لازم تنشر」.
Q2 (`WEBSITE-COPY-AUDIT-V1144.md`) had not appeared when this wave was applied; Q1 §13 was used as the internal-leak list.
The CLI fact was supplied and verified by the parent session: `sadeem-cli` 11.12.1 is published on npm.

---

## 1. What was removed from the public page

| Internal / developer-only item | Before (file:line) | After |
| --- | --- | --- |
| Giant "RELEASE INSTRUMENT" engraved panel with two full SHA-256 rows | `website/app/download/page.tsx:32-34, 44-104` | Calm release summary: version + platform + what is included; hashes only inside a collapsed `<details>` (`page.tsx:44-114`, verify panel at `:91-103`) |
| `STABLE BUILD · BRING YOUR OWN KEY` / `PUBLISHED CHECKSUMS · VERIFY BEFORE RUNNING` / `SADEEM / v…` footer | `page.tsx:60-62, 96-100` | `FREE DURING THE PUBLIC SEASON · BRING YOUR OWN KEY` and `INSTALLER · PORTABLE ZIP · SAME APP` (`page.tsx:61, 109-110`) |
| Engraved `SHA-256` stamp under the isometric box (decoration) | `DownloadPage.tsx:90-95` | Removed; the hairline box, seal, hatch and dimension line are untouched (`DownloadPage.tsx:19-102`) |
| Raw SHA-256 displayed at full width in every download row | `DownloadPage.tsx:228-242` | Moved into `<details><summary>Verify checksum</summary>` — copy button and `expectedSha256` prop unchanged (`DownloadPage.tsx:221-245`) |
| "Updates are manual" note + "update feed not published yet" + `SITE.updateFeed` link | `DownloadPage.tsx:273-280`, rendered at `:562` | Removed entirely; note renderer no longer special-cases `SITE.updateFeed` (`DownloadPage.tsx:260-288`, `:570`) |
| FAQ "How do updates work?" (manual updates / unpublished feed) | `DownloadPage.tsx:330-336` | Removed (`DownloadPage.tsx:313-353`) |
| SmartScreen / "we have not bought a code-signing certificate yet" / "code-signed build is planned" / "UNSIGNED BUILD" | `DownloadPage.tsx:264-271, 424-428` | Removed; replaced by user-facing installer / key / public-season notes (`DownloadPage.tsx:260-288, 414-418`) |
| NSIS packaging label, "Artifacts are served from this page when the release is published" | `DownloadPage.tsx:510, 532-534` | `Installer · ~108 MB`; "Open Verify checksum under a file to see its SHA-256 value." (`DownloadPage.tsx:513, 523-525`) |
| "seven-day guest pass" / device-level entitlement mechanics in Quick start + FAQ | `DownloadPage.tsx:304-307, 337-343` | "Start without an account. Sign in when you want to sync settings across devices." (`DownloadPage.tsx:303-307, 336-341`) |
| "encrypted at rest", absolute "no telemetry" / `#NO_TELEMETRY`, "Local by conviction" | `DownloadPage.tsx:299-302, 609-615` | "Local-first." + "Workspace files and API keys stay on your device. Provider calls go directly to the provider you choose." Two tags kept (`DownloadPage.tsx:620-629`) |
| Hype adjectives: "learns with you", "gets sharper", "The…", "watch the plan and the proof" | `DownloadPage.tsx:421-423, 309-312` | Definition + verb list; concrete outcomes (`DownloadPage.tsx:410-412, 307-311`) |

Line numbers in the "Before" column refer to the file as it was read at the start of this wave;
"After" numbers refer to the current files.

## 2. What was added

- **Shipped CLI block** — `DownloadPage.tsx:528-551`. One short section, section index `02 / COMMAND LINE`:
  - `npm i -g sadeem-cli`
  - `sadeem run "<task>"`
  - "Run sadeem on its own to open an interactive session."
  - Honest one-line explanation: the CLI runs the same agent engine as the desktop app and uses the provider key you supply.
  - Sections renumbered: files `01`, command line `02`, before you run `03`, quick start `04`, FAQ `05`.
- **BYOK truth** — `DownloadPage.tsx:270-276, 321-326`: the user supplies the key, the provider bills model calls, the key stays on the device. No claim of free inference.
- **Free season** — stated plainly in the release summary, hero meta and a note; no subscription/credit language anywhere on the page.
- **EN fully EN / AR fully AR** — every rewritten `tx()` pair has real English and Arabic copy; no mixed-language sentences in visible prose.

## 3. What was deliberately left intact

- `ChunkedDownload` component and its call sites (`DownloadPage.tsx:244, 253`) — parts list, filename and `expectedSha256` are unchanged.
- All download URLs and hash values in `site.ts`.
- All CSS and hairline art: crosshairs, orbit, four-pane mark, dimension line, `rule-art`, seal spin, version sweep.
- FAQ accordion behaviour, language toggling (`tx` / CSS `dl-en` / `dl-ar`), metadata export in `page.tsx:1-30`.

## 4. Verification

- `cd website && npx tsc --noEmit` — **pass**.
- `cd website && npm run build` — **pass** (Next.js 16.4.6, 14 static pages, `/download` prerendered).
- `node tests-v1142-seo.mjs` — `PAGE-download` and `BUILD-download.html` **pass**; `H1-download` and `LANG-1` (v1138) **pass**.
- Rendered `.next/server/app/download.html` grep — **0 hits** for: `manual`, `Updates are manual`, `update feed`, `موجز التحديث`, `unsigned`, `غير موقّع`, `code-signing`, `SmartScreen`, `RELEASE INSTRUMENT`, `أداة الإصدار`, `PUBLISHED CHECKSUMS`, `STABLE BUILD`, `seven-day`, `guest pass`, `NO_TELEMETRY`, `بلا تتبع`, `staged`. The real SHA-256 values remain only inside the collapsed verify panels and the client verification payload, as intended. The CLI commands appear once each in visible copy.

## 5. Out-of-scope items handed back (not edited here)

1. **`website/lib/site.ts:87` (Q6 owns metadata):** `SEO.download.description` still reads
   "Download SADEEM 11.12.0 for Windows 10/11 x64: NSIS installer or portable ZIP with published SHA-256 checksums. …"
   This is the only remaining `NSIS` / "published checksums" string in the rendered `/download` HTML (meta tags + JSON-LD). It should be rewritten to the new copy without publishing language, e.g.
   "Download SADEEM 11.12.0 for Windows 10/11 x64 as an installer or portable ZIP. Free during the public season with your own provider key."
2. **`node tests-v1140-hero-honesty.mjs`** currently reports `11 PASS / 3 FAIL`: H1 and H7 (homepage hero in `website/app/page.tsx` / `home.css`) and H14 (`site.ts` features SEO description). None of these files is owned by this wave; they appear to be concurrent work from other v1144 agents.
3. **`node tests-v1142-seo.mjs` / `tests-v1138-seo.mjs`** fail only on ROOT-1 / PAGE-home / BUILD-index.html (root layout metadata), plus changelog/auth in v1142. All download-related checks pass.
