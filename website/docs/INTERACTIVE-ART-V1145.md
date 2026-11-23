# Interactive Art — v11.45 (CursorField · RevealOnScroll · MagneticLink)

> **طلب المؤسِّس / Founder's brief:** «مثال الكشاف… لما أحرّك الماوس تصير دوائر ملوّنة باتجاه الماوس بنفس ألوان الموقع، دوائر تمشي مع الماوس. قدرات تفاعلية مدهشة ت جعل الموقع تفاعلي جداً… أول ما يدخل المستخدم ينبهر بصرياً، تؤثر العين قبل القلب.»
>
> **الترجمة العملية:** حقلُ حلقاتٍ رفيعةٍ بلون اللّايم وألوان الحبر، يتبع المؤشّر بتمهيد (lerp) كأداة ضبط دقيقة — لا فوضى جسيمات قزحية. محصور، هادئ، لا يحجب النقر، ويعمل بالاتجاهين (RTL/LTR) والوضعين (فاتح/داكن).

All four files are **new only** — no existing TSX/CSS was edited. Components are self-contained (each imports its own CSS) and compile standalone.

---

## 1. الملفات الجديدة / New files

| File | Purpose | Key lines |
|---|---|---|
| `website/components/interactive/CursorField.tsx` | Fixed full-viewport canvas: 3–7 concentric 1px rings + registration ticks + faint travel needle, eased behind pointer | component `:54`, draw loop `:99–143`, easing loop `:147–159`, render `:204–212` |
| `website/components/interactive/RevealOnScroll.tsx` | IntersectionObserver one-shot reveal: 1px hairline draws + fade-up | component `:37`, observer `:50–81`, render `:86–97` |
| `website/components/interactive/MagneticLink.tsx` | Bounded magnetic translate (≤4px) + tilt (≤1.5deg), reset on leave | component `:30`, transform loop `:63–76`, clamp `:84–85`, render `:121–125` |
| `website/components/interactive/InteractiveArt.css` | All styles — hairlines only, token-only colour, logical properties, kill switches | field `:24–36`, reveal `:41–66`, magnetic `:70`, kill switches `:73–92` |

---

## 2. الاستخدام — أسطر الاستيراد بالضبط / Exact import + usage lines

### 2.1 `CursorField` — يُركّب مرة واحدة في الـ layout (global, like `CursorHalo`)

In `website/app/layout.tsx`:

```tsx
import { CursorField } from '@/components/interactive/CursorField';
```

Place it inside `<body>`, beside the existing visual layer (the CSS import is automatic):

```tsx
        <InkGrain />
        <ScrollProgress />
        <PageCurtain />
        <CursorHalo />
        <CursorField />          {/* ← add here */}
        <ArtRuntime />
```

Optional props (all have safe defaults — `<CursorField />` is enough):

```tsx
<CursorField rings={6} ease={0.12} />
```

- `rings` clamped to **3–7** — `CursorField.tsx:79`
- `ease` clamped to **0.04–0.35** — `CursorField.tsx:80`

### 2.2 `RevealOnScroll` — يلفّ الأقسام في أي صفحة / wrap sections in any page

```tsx
import { RevealOnScroll } from '@/components/interactive/RevealOnScroll';
```

```tsx
<RevealOnScroll as="section" className="section" index={0}>
  <h2 className="h2">Ink on paper.</h2>
  <p className="lead">A local-first agent that learns from every run.</p>
</RevealOnScroll>

{/* staggered children: each wrapper gets its own --i */}
<RevealOnScroll as="div" className="grid cols-3" index={1} delay={80}>
  ...cards...
</RevealOnScroll>
```

Props: `as`, `className`, `style`, `index`, `delay`, `threshold`, `once` (default `true`), `rule` (default `true`). See `RevealOnScroll.tsx:20–35`.

**SSR note:** the hidden state is armed only under `html[data-js='1']`, which this site already sets pre-paint in `app/layout.tsx:170` (injected at `:177`). With JS disabled, content is fully visible — no hydration break, no blank sections. No layout edit is required for this component.

### 2.3 `MagneticLink` — للأزرار والروابط / for buttons and links

```tsx
import { MagneticLink } from '@/components/interactive/MagneticLink';
```

```tsx
import Link from 'next/link';

<MagneticLink>
  <Link href="/download" className="btn btn-solid">Download</Link>
</MagneticLink>

{/* works on a button too */}
<MagneticLink strength={0.12} max={3} tilt={0.8}>
  <button className="btn" type="button">Try it</button>
</MagneticLink>
```

Props: `children`, `className`, `style`, `strength` (default `0.14`), `max` (default `4`, **hard-capped at 4px**), `tilt` (default `1`, capped at `1.5deg`). See `MagneticLink.tsx:14–24` and `:26–28`.

**Keyboard:** no focus handlers are attached — the global `:focus-visible` ring (`app/globals.css:49`) is unchanged; translate/tilt are pointer-only (`MagneticLink.tsx:45–56`).

---

## 3. السلوك والضمانات / Behaviour & guarantees

- **لا يحجب النقر / never blocks clicks:** `CursorField` is `pointer-events:none` (`InteractiveArt.css:31`) and `aria-hidden` (`CursorField.tsx:210`). `MagneticLink`'s wrapper only listens to pointer events on itself and never calls `preventDefault`.
- **ألوان الرموز فقط / token-only colour:** the canvas re-reads `--accent`, `--accent-fill`, `--line`, `--line-strong`, `--faint` from `:root` (`CursorField.tsx:37–52`, refreshed on theme/dir flip at `:176–189`). CSS contains **zero literal hex** (`InteractiveArt.css:4`). Lime = the site's `--accent`/`--accent-fill`; ink hues = the line/faint tokens.
- **RTL:** the ring field is radial (`clientX/clientY`, no left/right logic); the reveal hairline flips its origin with `html[dir='rtl']` (`InteractiveArt.css:53`) and uses `inset-inline` / `block-size` logical properties throughout.
- **Both themes:** clean re-read on `data-theme` change — no hardcoded theme overrides, no new palette.
- **حركة مخفّضة / reduced motion — ثلاث بوابات / three gates:** `@media (prefers-reduced-motion: reduce)`, `html.reduce-motion`, and `html[data-art='off']` (`InteractiveArt.css:73–88`); `data-cursor='off'` also hides the field (`:90`). JS independently refuses to start on fine-pointer miss, touch, reduced motion, `reduce-motion`, `data-art='off'` — see `CursorField.tsx:64–77`, `RevealOnScroll.tsx:55–66`, `MagneticLink.tsx:45–56`.
- **End state = static and legible:** reveal resolves to `opacity:1; transform:none; rule scaleX(1)`; magnetic resolves to `transform:none`; field is hidden. No hidden content, no looping animation.
- **Performance:** all loops are rAF-driven, sleep at rest, pause on `document.hidden` / blur (`CursorField.tsx:145–159`, `:170–173`), and cap DPR at 2 (`:90`). Magnetics release their inline transform completely at rest (`MagneticLink.tsx:74`).

---

## 4. التحقق / Verification

Run from `website/`:

```bash
npx tsc --noEmit
npm run build
```

Result (this branch): **both passed** — `npx tsc --noEmit` produced no diagnostics; `next build` (Next.js 16.4.6, Turbopack) compiled successfully, finished TypeScript, and prerendered all 14 static pages. The four new files are self-contained and do not require the parent's wiring to compile.

> Parent wiring checklist: add the `CursorField` import + `<CursorField />` in `app/layout.tsx`; import `RevealOnScroll` / `MagneticLink` only on the pages that use them. Nothing else needs changing.
