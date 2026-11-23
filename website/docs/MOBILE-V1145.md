# MOBILE-V1145 — تقرير تجربة الهاتف / Mobile experience report

> Scope: **responsive CSS only**. The entire fix lives in ONE new file,
> `website/app/mobile.css`. No desktop/base rule and no prose was edited.
> Files owned by R4 (`home.css`, `hero-panels.css` desktop) and R5
> (`art-motion.css`, `features.css`, `pricing.css`, `docs.css`,
> `download.css`, `changelog.css` art) were **not touched**.

---

## 0. الإجراء المطلوب من الأب / Action required from the parent

`mobile.css` is deliberately **not imported yet** so it cannot collide with
the other workstreams. Add this exact line to `website/app/globals.css`,
as the second `@import` (CSS requires every `@import` before all other rules):

```css
@import './art-motion.css';
@import './mobile.css';   /* ← ADD THIS LINE (line 2) */
```

With that line in place, all 7 routes inherit the layer automatically (see §3).

---

## 1. التدقيق (قراءة فقط) / Audit — read-only findings

 line numbers refer to the files as read at the start of this task.

### 1.1 أسباب التمرير الأفقي / Horizontal-overflow sources

| # | file:line | problem |
|---|-----------|---------|
| 1 | `app/globals.css:61` | `.cols-2{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}` — a 300px minimum overflows once content width drops below ~340px (320–360px phones). |
| 2 | `app/globals.css:70,72` | `.display` min `52px`, `.h2` min `36px` — long unbroken display words can outgrow a 320px content box. |
| 3 | `app/globals.css:125-129` | `.table` has no wrapping or overflow container; multi-column tables push the page sideways. |
| 4 | `app/globals.css:138,166` | `.wordmark{font-size:clamp(90px,20vw,300px);white-space:nowrap}` — the footer wordmark overflows and is only hidden by `.site-foot{overflow:hidden}`. |
| 5 | `app/home.css:38` | `.hero-title{font-size:clamp(48px,7.4vw,106px)}` — 48px floor is too large on a 360px screen. |
| 6 | `app/home.css:75,85-90` | `.hm-scene` is a 12-column mosaic with fixed `grid-column` spans — a cramped grid, not a readable stack. |
| 7 | `app/home.css:465` | `.appmock-chat{flex:0 0 clamp(360px,58%,560px)}` — a 360px floor forces the console wider than the viewport (only mitigated below 760px). |
| 8 | `app/home.css:685,692` (`hero-panels.css:685,692` style) / `app-mock.css:168-179` | `.appmock-phases`, `.appmock-hint`, `.appmock-quick`, `.appmock-effort` are `white-space:nowrap` and can extend past the frame. |
| 9 | `app/pricing/pricing.css:40-41` | `.cmp-scroll{overflow-x:auto}` + `.cmp-table{min-width:780px}` — the comparison table is the single biggest forced-width element; `min-width:780px` must be neutralised on mobile. |
| 10 | `app/pricing/pricing.css:56,69` | `.price-closing-title` min `42px`; `.price-stamp{width:118px;height:118px;transform:rotate(-8deg)}` — rotated art needs a smaller footprint. |
| 11 | `app/docs/docs.css:23-25,32` | `.docs-layout` 210px sidebar column + `.docs-index` sticky `top:100px` (70px at ≤900) — no safe-area, no tap sizing. |
| 12 | `app/docs/docs.css:209` | `.doc-code pre{clip-path:inset(-12px 100% -12px 0)}` — reveal clip; harmless under reduced motion (`docs.css:213-221`) but couples legibility to JS. |
| 13 | `app/download/download.css:6,127` | `.d-page{overflow:hidden}` hides overflow instead of fixing it; `.dl-inst-ver-num` min `54px` is too wide for `v11.12.0`. |
| 14 | `app/changelog/changelog.css:6,25,48-53` | `.c-page{overflow:hidden}`; `.c-ver` min `46px`; `.c-timeline/.c-rail/.c-node` use physical `left:36px / 17px / -28px` absolute art. |
| 15 | `app/auth/auth.css:38` | `.auth-pair .mono{font-size:18px;letter-spacing:.24em}` — long pairing codes overflow. |
| 16 | `app/auth/auth.css:76` | `.auth-recap-row{grid-template-columns:120px 1fr}` (90px below 520px) — cramped label column. |
| 17 | `app/features/features.css:285` | `.palette-typed{white-space:pre}` — the one genuine code-line overflow on `/features` (the sibling `.term-body` at `:244-255` already wraps correctly). |
| 18 | `app/chrome.tsx:65-67` | header is `position:sticky;top:0` with an **inline** `style={{height:70}}` — cannot be changed from a stylesheet without `!important`; no safe-area inset. |
| 19 | `app/chrome.tsx:77-80` | language button + theme button + Download button + menu button all sit in the header row; at 360px they crowd the brand. |

### 1.2 السلاسل الطويلة / Long mono strings and code lines

Already partly handled in the base sheets — `download.css:53,66,145`,
`docs.css:95-106`, `features.css:244-255`, `home.css:255,564`,
`auth.css:33` use `overflow-wrap:anywhere`. Gaps that remained:
`features.css:285` (`white-space:pre`), `hero-panels.css:431`
(`.hm-cli-body span{white-space:pre}`), shared `.mono`, and every
`.table`/`.cmp-table` cell. These are fixed in mobile.css §6.

### 1.3absolute-positioned art / عناصر فنية مطلقة

`globals.css:103` (`.art-overlay`), `globals.css:234-243`
(`.artcorner--tl/tr/bl/br`, 84×84 fixed), `features.css:19-27`
(`.crosshairs i`), `download.css:110-119` (`.dl-inst .crosshairs`),
`changelog.css:48-58` (`.c-rail`, `.c-node`),
`art-motion.css:197,213` (mask pseudo-elements). They are decorative and
`pointer-events:none`, so they do not cause scroll; the mobile layer only
shrinks the two mask pseudo-elements (`download.css:213`, `art-motion.css:213`)
and re-anchors the changelog rail.

### 1.4 الرأس اللاصق / Sticky headers

`globals.css:151` `.site-head{position:sticky;top:0;z-index:50}`,
`docs.css:32,135-144`, `features.css:156,329-343`. On a notched phone the
70px header plus `top:70px` rails leave no safe-area and swallow tap targets.
See `chrome.tsx:65-80` above.

### 1.5 الحركة / Motion load on mobile

Infinite loops that were running at 2.8s cadence on every phone:
`art-motion.css:88,103,107,113,269-301`, `hero-panels.css:535-601`
(`hpx-dwell`, `hpx-float`, `hpx-tick-on`), `home.css:226-234` (demo orbit),
`download.css:93,138`, `changelog.css:61,74`, `auth.css:102-111`,
plus cursor/parallax layers `globals.css:192,208` and
`hero-panels.css:358-386`. All are calm-stopped in mobile.css §7.

### 1.6 ما سليم بالفعل / Verified OK (no change needed)

* **Viewport meta** — there is no `export const viewport` in `app/`, but
  Next.js 16.4.6 emits a default one. Confirmed in
  `node_modules/next/dist/lib/metadata/default-metadata.js:26` →
  `createDefaultViewport()` returns `width:'device-width', initialScale:1`.
  So the phone is **not** rendering a 980px desktop viewport and scaling down;
  the reported problem is layout, not meta.
* `.wrap` (`globals.css:52`) is already symmetric with `padding-inline`.
* Body font-size (`globals.css:43`) is already 16px (≥15px requirement met).
* `prefers-reduced-motion` is already honoured globally (`globals.css:148`)
  and per layer; mobile.css adds a higher-specificity blanket in §7.
* Optional (parent only, not CSS): add `viewportFit:'cover'` to a
  `viewport` export in `app/layout.tsx` if real notch safe-area values are
  wanted. Without it, `env(safe-area-inset-*)` resolves to `0` — the mobile
  layer still works, it just has no notch inset to consume.

---

## 2. الإصلاحات / Fixes applied in `mobile.css`

| section | what it does |
|---|---|
| §0 foundation | `overflow-x:clip` on `html,body` (**clip, not hidden — keeps `position:sticky` alive**), symmetric safe-area padding, fluid `img/svg/video`, one-column grid flow for every shell, `scroll-padding-top`, ≥44px tap targets. |
| §1 header/footer | Overrides the inline `height:70` → `56px !important`, hides the header Download button (present in the menu), hides `.brand-ver`, 44px icon buttons, 48px mobile-nav links, `max-height:60vh` scrollable menu, smaller symmetric footer wordmark. **This is the direct fix for "كل شيء بجهة"** — no lopsided fixed-width chrome remains. |
| §2 type | Fluid `clamp()/vw` display sizes, body kept at 16px, small instrumentation raised to 13px, Arabic line-height kept roomy. |
| §3 home | Centred hero copy/actions; **mosaic becomes a vertical stack of full-width panels** (`grid-template-columns:minmax(0,1fr)`, every `.hm-panel{grid-column:1/-1}`), miniature work pane hidden so chat keeps full width; demo/proof/closing reflow to one column. |
| §4 app mock | 760px stack made phone-safe: chat full width, work pane capped and scrollable, rail/head horizontally scrollable **inside** the frame, 44px composer buttons, 16px input (prevents iOS auto-zoom). |
| §5 routes | Per-route single-column + font/space fixes for `/features`, `/pricing`, `/docs`, `/download`, `/changelog`, `/auth`; `.cmp-table{min-width:0}` removes the 780px forced width; hashes/paths/pairing codes wrap. |
| §6 long strings | One blanket guard for `.mono, code, pre` and every code/path/hash selector; `white-space:pre → pre-wrap`; tables become contained `overflow-x:auto` with `max-width:100%`. |
| §7 motion | `--art-dur:.35s`, `--art-cadence:1.2s`, `--art-rule-dur:.5s`; cursor/parallax layers hidden; **all infinite decorative loops stopped**; one-shot reveals still run (shorter); `prefers-reduced-motion` blanket and `.reduce-motion`/`[data-art='off']` honouring. |
| §8 360–400px | Extra-tight padding, smaller display/button/hash sizes for the narrowest reported phones. |

### لماذا `!important` / Why every override is `!important`

`@import` must be the first statement in `globals.css`, so `mobile.css` is
inlined **before** the rest of `globals.css` and before each route's CSS
(imported from `page.tsx`). Equal-specificity rules that load later would
otherwise win. `!important` makes this a deterministic override layer and
also beats the header's inline `style={{height:70}}`. No desktop value is
edited in place; turning mobile off is one line (remove the import).

---

## 3. التغطية — كيف تشمل المسارات السبعة / Scope across all 7 routes

`app/layout.tsx:11` imports `./globals.css` in the **root** layout, whose
`<body>` wraps `<SiteHeader/>`, `<main>{children}</main>`, `<SiteFooter/>`
(`layout.tsx:203-214`). Adding `@import './mobile.css';` there means the
layer is in the shared CSS chunk for:

| route | hook classes covered by mobile.css |
|---|---|
| `/` | `.hero*`, `.hm-*`, `.hpx-*`, `.demo-*`, `.benefit*`, `.proof*`, `.appmock-*` (§3–4) |
| `/features` | `.feat-*`, `.fp-*`, `.anatomy-*`, `.palette-*`, `.term-*` (§5) |
| `/pricing` | `.price-*`, `.cmp-*`, `.season-*`, `.faq-*` (§5) |
| `/docs` | `.docs-*`, `.doc-code`, `.sec-*` (§5) |
| `/download` | `.d-*`, `.dl-*` (§5) |
| `/changelog` | `.c-*` (§5) |
| `/auth` | `.auth-*`, `.au-*` (§5) |

Plus the truly global selectors in §0–2 and §6–7 (`html`, `body`, `.wrap`,
`.grid`, `.btn`, `.icon-btn`, `.mono`, `code`, `pre`, `table`, `.wordmark`,
`.site-head`, `.site-foot`) which apply to the chrome on **every** route,
and the reduced-motion/motion-calming rules which are route-agnostic.

---

## 4. التحقق / Verification (performed)

* `cd website && npx tsc --noEmit` — **pass** (no output/errors).
* `cd website && npm run build` — **pass**. Next.js 16.4.6 (Turbopack),
  compiled successfully, TypeScript finished, all 14 static pages generated,
  including `/`, `/auth`, `/changelog`, `/docs`, `/download`, `/features`,
  `/pricing`.
* Temporary-import method: the `@import './mobile.css';` line was added to
  `globals.css` for the build, then **reverted** — `globals.css` is back to
  its original single `@import './art-motion.css';` (verified at line 1).
* Bundle proof: the compiled chunk `.next/static/chunks/2oy26n5n2rj-x.css`
  contains the mobile rules (`env(safe-area-inset-left)`, `min-height:44px!important`)
  together with `.hm-panel` — i.e. it is the shared global chunk, not a
  route-local one.
* Source guard (no fixed px width > viewport in mobile.css): the only
  fixed widths are `44px` (tap targets), `88px` (stamp), `18px` (glyph) —
  **all ≤ 88px**, far below the 360px minimum viewport. `150px`/`340px`
  values are `max-height` (scroll caps), not widths. Breakpoints 400/600/900
  are media queries, not element widths. **PASS.**

---

## 5. ملخص للمؤسس / Founder summary (Arabic)

تم إصلاح تجربة الهاتف بالكامل في ملف واحد جديد `app/mobile.css` دون لمس
ملفات سطح المكتب أو النصوص. السبب الرئيسي لشكوى «كل شيء بجهة» كان رأساً
ثابتاً بارتفاع 70 بكسل مكتوباً كـ inline style مع أزرار مزدحمة، وشبكة
فسيفساء من 12 عموداً، وجدول مقارنة بعرض 780 بكسل إجباري. الآن: كل شيء
عمود واحد، الفسيفساء مكدسة رأسياً، الهوامش متناظرة مع مساحات آمنة،
النصوص المقروءة 16 بكسل وأزرار اللمس 44 بكسل، الشيفرات والتجزئات
تُلتف ولا تُخرج الصفحة للتمرير الأفقي، والحركات المتكررة تتوقف على
الهاتف مع احترام تفضيل تقليل الحركة. وجدنا أن وسم viewport سليم بالفعل
(افتراضي Next.js). **المطلوب فقط**: إضافة سطر الاستيراد في §0 أعلاه.
كل المسارات السبعة مغطاة لأن الملف مستورد من التخطيط الجذري.
