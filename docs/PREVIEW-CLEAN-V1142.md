# PREVIEW CLEAN — v11.42

## الحكم (Arabic — blunt)

**المعاينة كانت متداخلة فعلاً. الآن لا تداخل.** كان فيها: لABEL المصدر مكرّر مرّتين، ومؤبّر حالة (LED) مكرّر مرّتين — يعني "شريحة جاهز" اثنتين — وشريط تحميل كان مرسوماً **فوق** الكانفاس ومزاحماً شريط URL. كل عنصر صار له مكان ثابت في التخطيط المرن (flex column / flex row with wrap). ما حذفنا أي ميزة حقيقية: شريط URL، إعادة التحميل، الفتح الخارجي، أحجام الأجهزة، سجل الأخطاء الصادق — كلها موجودة وتعمل.

**تحذير تكافؤي (handoff):** أثناء العمل أضافت Passing موازية قسم زخرفة (frame + eye) إلى نفس الملف `preview.css` بـ `position:absolute` فوق شريط "Built" — هذا أعاد التداخل وكسر اختباراً قديماً. أعدت كتابته داخل التدفق الطبيعي (flex items) بحركة opacity فقط. تفاصيلها في قسم `HANDOFF` أدناه.

## Verdict (English — blunt)

**The preview panel really was overlapped. It is clean now.** Three concrete overlap bugs were found and fixed; no real feature was removed. Everything now occupies its own place in the flex layout. The only remaining absolute layers are the two mutually-exclusive diagnose surfaces over a *dead* guest page — that is intentional z-layering, not clutter.

---

## 1 · Overlap findings + fixes (source, file:line)

| # | Bug (before) | Where it was | Fix (after) |
|---|---|---|---|
| 1 | **Source label rendered twice** — a static `glass-pill` plus the real source-selector button both printed `sourceLabel` | `src/components/PreviewArea.tsx` (old lines 788–790 and 813) | Removed the static pill; label lives only in the selector that owns the `onClick`. Marker comment at `PreviewArea.tsx:788`. |
| 2 | **Two "ready" chips / duplicate status LED** — `.pv-status` chip and the URL field both rendered `pv-led is-${previewState}` from the same state | `src/components/PreviewArea.tsx` (old lines 799 and 859) | Kept the single `role="status"` chip at `PreviewArea.tsx:795–803` (the one LED is at `:801`). URL field now starts directly with the input at `:862`. |
| 3 | **Status ribbon over the canvas / crowding the URL bar** — `.pv2-loading` was `position:absolute; top:0; z-index:10` | `src/components/preview.css` (old `.pv2-loading` block) + `PreviewArea.tsx` (old lines 1277–1283) | Moved into normal flow as its own flex row at `PreviewArea.tsx:1123–1133`; `.pv2-loading` is now a flow band with a 1px hairline at `preview.css:91–102` (no `position`, no `z-index`). |
| 4 | **Toolbar forced onto one 44px line** — every control squeezed/stacked on narrow panels | `preview.css:23–31` | `.pv2-bar` is now `flex-wrap: wrap; height: auto; min-height: 44px; row-gap: 6px`. URL field gets `min-width: 220px; flex: 1 1 240px` at `preview.css:32–40` so it wraps instead of collapsing into its neighbours. |
| 5 | **Concurrent art overlap** — `::after` "eye" was `position:absolute` on top of the `::before` frame | `preview.css` section 6 (added by a parallel v11.42 pass) | Refactored both pseudo-elements into ordinary flex items of the built band, opacity-only motion: `preview.css:165–231`. No stacked layers. |

### Intentional z-layers (kept, documented)
- `PreviewArea.tsx:1296` — `pv2-failed absolute inset-0 z-10`: honest error card over a **dead** guest page.
- `PreviewArea.tsx:1337` — blank-page hint: `blankHint && !failed && !loading`, so it never stacks on the failed card or the loading band.
- Dropdown menus (`Popover`, `absolute top-full z-40`) are intentional click-dismissed menus, not panel clutter.
- Documented at `preview.css:233+` (section 7).

---

## 2 · Verification (all green in final run)

Command:
`node --test --test-force-exit --test-concurrency=4 <files>`
plus `npx tsc --noEmit`.

**Final aggregate: 101 / 101 tests pass, 0 fail.**

| Check | File | Result |
|---|---|---|
| DNA learning | `tests/v1134-dna-learning.test.mjs` | PASS — real accumulation, honest caps, second-run prompt |
| DNA guard | `tests/v1127-dna-guard.test.mjs` | PASS — dna.json → events → store → prompt |
| Playbook | `tests/v1112-playbook.test.mjs` | PASS — real file writes, version history, prompt injection |
| High / effort | `tests/v1138-effort.test.mjs` | PASS — real `reasoning_effort` / `budget_tokens` on the wire |
| MCP guard (see note) | `tests/v1138-mcp-real.test.mjs` | PASS — real stdio/HTTP round-trips, honest disconnect |
| Schedule guard (see note) | `tests/v1138-schedule.test.mjs` | PASS — cron, restart, webhook, concurrency |
| Preview (auto-open) | `tests/v1138-preview.test.mjs` | PASS — real port, real HTTP 200, no fabricated ready |
| Internet preview | `tests/v1134-internet.test.mjs` | PASS in final run; see flake note |
| **New clean-layout test** | `tests/v1142-preview-clean.test.mjs` | **PASS 10/10** — source + CSS + SSR of the real component (EN/AR) |
| Preview UI regression | `tests/v1126-preview-ui.test.mjs` | PASS — 1px contract, no glow, opacity-only animation |
| UI overlays regression | `tests/v1131-ui-overlays.test.mjs` | PASS |
| Types | `npx tsc --noEmit` | PASS (clean, no output) |

### Notes handed to parent (no edits made to those files)
1. **Names:** there is no `v1138-mcp-guard` / `v1138-schedule-guard` file. The real guards are `tests/v1138-mcp-real.test.mjs` and `tests/v1138-schedule.test.mjs`; both were run and pass.
2. **Flake:** on the *first* combined run, `tests/v1134-internet.test.mjs:326` ("python preview is detected and started with a real URL") failed once with `no preview URL announced within 9000 ms — last log: $ python app.py [python]` — a 9s start timeout, not a code defect. It passed on isolated re-run and in the final combined run. Read-only — owner of `previewService.ts` may consider raising the timeout / making the Python bind announcement more robust.
3. **Art collision:** see section 1 row 5. The parallel v11.42 art pass wrote into my owned `preview.css`. I preserved the *motif* (frame + breathing eye) but moved it into flex flow and made motion opacity-only because (a) the founder explicitly demanded no overlap and (b) `tests/v1126-preview-ui.test.mjs:76` asserts "loading animation is opacity-only" using the regex `/@keyframes pv2-breathe \{[\s\S]*?translate|scale/`, whose ungrouped alternation matches the literal word `scale` **anywhere** in the sheet — the sibling's `scaleX/scaleY` and `--motion-scale` tripped it. If the art owner wants the exact original transform-based version back, coordinate with parent — but that version is an overlap and keeps that regression red.

---

## 3 · What was NOT touched

`electron/services/previewService.ts` was read only — no overlap bug found there; the internet test's one failure was a timing flake, not a layout/service defect. No engine, store, or other panel files were edited. All changes are confined to:
- `src/components/PreviewArea.tsx`
- `src/components/preview.css`
- `tests/v1142-preview-clean.test.mjs` (new)
- `docs/PREVIEW-CLEAN-V1142.md` (this file)
