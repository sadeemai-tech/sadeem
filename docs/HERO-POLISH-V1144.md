# HERO POLISH v11.44 — خطوط أدق، ديسكتوب أنظف، أنيميشن كفيلم
# Hero polish — larger type, cleaner desktop, film-like motion

> طلب المؤسس: «حسّن الخطوط المستخدمة، كبّرها قليلاً. حسّن دقة الديسكتوب —
> أشياء زايدة، أشياء مش واضحة. حسّن الأنيميشن لكل إشي: الترمينال، الداكس،
> CLI، الموبايل… أضف أنيميشن حركة زي كأنه فيلم أنيميشن. وأظهر تثبيت الـ CLI.»
>
> Founder: *"Improve the fonts, make them a bit bigger. Improve desktop
> precision — redundant marks, unclear things. Improve the animation of every
> panel (terminal, desktop, CLI, mobile) like an animation film. Show the CLI
> install like competitors."*

---

## 1 — النطاق / Scope

| File | Owned change | Lines |
|---|---|---|
| `website/app/home.css` | hero + mosaic label/mono caption font step; 1px hairline precision | `49–53, 60–70, 76–79, 95–154` |
| `website/app/hero-panels.css` | mini-UI type step, contrast tokens, precision block, all-panel motion, 3 kill switches | `50–433, 484–633` |
| `website/app/art-motion.css` | shared FILM MOTION primitives + eight feature glyphs | `243–323` |
| `website/app/page.tsx` | **inside `HeroMosaic()` only** — CLI panel shows the shipped commands | `640–650` |

No surrounding prose section was touched. `home.css` still owns no `hpx-*`
rule; `hero-panels.css` is still imported last (`page.tsx:35`).

---

## 2 — الخطوط / Font step (one clear readable step)

Instrument Serif stays the display face (`globals.css:9`); all figures stay
`font-variant-numeric: tabular-nums` + `font-feature-settings:'tnum' 1`
(`hero-panels.css:30–33`). Every size moved up exactly ~1px:

| Element | Before → After | Source |
|---|---|---|
| `.hero-note` | 10.5 / 11 → **11.5 / 12px** | `home.css:52–53` |
| `.hm-head-label` / `.hm-head-src` | 10 / 9 → **11 / 10px** | `home.css:64, 66` |
| `.hm-foot` / `.hm-index` / `.hero-figcap` / `.hm-foot-ver` | 9 / 8 / 9 / 9 → **10 / 9 / 10 / 10px** | `home.css:69–72` |
| `.hm-panel-top` | 9px / 25px → **10px / 26px** | `home.css:78–80` |
| `.hm-app-msg` / `.hm-app-tool` / `.hm-app-files` | 9 / 8 / 8 → **10 / 9 / 9px** | `home.css:107, 109, 114` |
| `.hm-code` / `.hm-editor-status` | 8.5 / 7 → **9.5 / 8px** | `home.css:122, 127` |
| `.hm-cli-body,.hm-term-body` | 8.5 → **9.5px** | `home.css:131` |
| `.hm-phone-state/-code/-btn` | 6 / 8 / 6 → **7 / 9 / 7px** | `home.css:144–146` |
| `.hm-cron-row/-state` | 8.5 / 8 → **9.5 / 9px** | `home.css:151, 157` |
| rail numbers / chat head / brand | 5.5 / 6 / 6 → **6.5 / 7 / 7px** | `hero-panels.css:50, 58–65` |
| reason / tool row / OK | 6.5 / 7 / 6.5 → **7 / 8 / 7px** | `hero-panels.css:84–103, 219` |
| modes / composer input / model / quick | 5.5 / 7.5 / 6 / 6 → **6.5 / 8.5 / 7 / 7px** | `hero-panels.css:113–150` |
| attach head / rows | 6 / 6.5 → **7 / 7.5px** | `hero-panels.css:164–170` |
| plan / sliver / work head / preview bars | 5.5 / 6 / 5.5 / 5.5–6 → **+1px each** | `hero-panels.css:202–315` |
| preview nav / kicker / h1 / lead / cards / stamp | 4.5 / 4.5 / 12 / 5 / 5 / 5.5 → **5.5 / 5.5 / 13 / 6 / 6 / 6.5px** | `hero-panels.css:286–319` |
| tabs / breadcrumb / code / status / CLI bar / CLI body | 6.5 / 6 / 7 / 6 / 6 / 7 → **7.5 / 7 / 8 / 7 / 7 / 8px** | `hero-panels.css:389–430` |

`.hm-app` height follows the taller header: `calc(100% - 26px)`
(`home.css:95`).

---

## 3 — دقة الديسكتوب / Desktop precision (`hero-panels.css:484–497`)

- **لا أشياء زايدة** — the editorial panel header dropped its duplicate
  window dots; the app's **own** titlebar keeps the only three
  (`.hm-desktop .hm-panel-dots{display:none}`, line 491).
- **4px rhythm** — tool row, compose row and preview bar all snap to `gap:5px`
  (lines 492–496); the tool glyph is a fixed 11px box (line 497).
- **Exact 1px hairlines** — `box-sizing:border-box` scoped to the miniature's
  own elements (lines 488–490), so every `1px solid var(--line*)` rule measures
  a true device pixel. Active editor tab now uses a drawn 1px underline
  instead of a static border (`.hm-editor .hpx-tab.is-active{border-block-end-color:transparent}`,
  line 498; the drawn line itself is `hero-panels.css:560–566`).
- **No unclear text** — all 23 miniature text tokens moved from low-contrast
  `--faint` to adaptive `--dim` across `hero-panels.css` (e.g. rail numbers,
  chat head, tool path, tabs, CLI bar), so labels read in **both** themes.
  Decorative dots keep `--faint`.

The mini-app remains unmistakably the real shell: numbered `DEMO.nav` rail,
`01 AGENT CONSOLE` + session + status dots, one `read_file` tool row on a 1px
rail, mode chips + input + `+` + mic + 62% context orb + Send, and the live
preview with URL bar / rendered page / verified stamp.

---

## 4 — أنيميشن كفيلم / Cinematic motion

### Hero panels — `hero-panels.css:499–598`

- **One cadence family:** every duration/delay is a fraction or multiple of
  `--art-cadence` (2.8s). The single Desktop cursor still runs
  `calc(var(--art-cadence) * 2.5)` with its one `hm-cursor-path` keyframe
  (`hero-panels.css:366`) — **no second cursor keyframe, no app-mock copy**.
- **Shared primitives** (`hero-panels.css:507–533`): `hpx-panel-settle`
  (12px rise → 2px overshoot → rest), `hpx-row-in`, `hpx-line-draw`,
  `hpx-dwell` (16–44% hold, 60–88% quiet), `hpx-float`, `hpx-tick-on`.
  All eased (`cubic-bezier(.2,.7,.3,1)` / `(.45,0,.55,1)`), transform / opacity
  only, with genuine dwell.
- **Sequenced assemble** (`hero-panels.css:535–549`): Editor → CLI → Terminal
  → Mobile → Schedule each settle at 0.5 / 0.6 / 0.7 / 0.8 / 0.9 × cadence;
  rows file in with cadence-derived `nth-child` delays (0.64 → 0.88 ×).
- **One living accent per surface** (`hero-panels.css:551–598`): the editor's
  active underline writes once and its minimap breathes top-to-bottom like a
  slow scan; CLI/terminal `✓` lines, schedule state + cron LEDs, and the phone
  float + lime letter breathe on a 2× cadence loop. The terminal keeps its own
  honest `hpx-caret-blink` (`hero-panels.css:432–433`).
- **Base state = readable end frame**: no-JS, reduced-motion and data-art='off'
  show the complete panel, never an empty shell.

### Shared glyphs — `art-motion.css:243–323`

`am-film-in`, `am-dwell-breathe`, `am-glide` on the same 2.8s family; the eight
`/features` glyphs (`.am-glyph--tools … --privacy`) assemble in order then each
keeps one idea of motion. The privacy shield keeps its original draw-once
(`:not(.am-draw)`).

### Kill switches — everywhere

The three independent gates already present (`@media (prefers-reduced-motion:
reduce)`, `html.reduce-motion`, `html[data-art='off']`) were extended to every
new animation: `hero-panels.css:603–633` and `art-motion.css:304–323`. The
cursor is hidden in all three (`hero-panels.css:436, 449, 465` unchanged).

---

## 5 — الـ CLI الحقيقي / The shipped CLI (`page.tsx:640–650`)

The miniature terminal now shows the real, verifiable commands — not an
invented brand:

```
$ npm i -g sadeem-cli
  + sadeem-cli@11.12.1
$ sadeem run "fix the flaky test"
  ↳ read_file settings/theme-context.ts
  ✓ 2 tools · 512ms
$ sadeem preview
  → http://localhost:5173
```

`npm i -g sadeem-cli` is the root package's real name (`package.json`:
`"name": "sadeem-cli"`, `"private": false`) and `sadeem` is its real `bin`
(`package.json`: `"bin": { "sadeem": "dist-cli/surnia.cjs" }`), version
`11.12.1`. The output stays honest: no fake progress bar, no invented
benchmark. All guard-required CLI strings are preserved
(`tests-v1142-hero-panels.mjs:114–118`).

---

## 6 — التحقق / Verification (source math + tooling)

**Font / overlap math (max 1120px grid):** row 1 ≈ 179px (CLI, 8 lines at
8px/1.45 + 4px gaps + 18px bar + 26px header) ≥ editor ≈ 159px; row 2 ≈ 149px
(mobile phone); Desktop spans both = 340px, of which the app column keeps
≈254px for chat (18 head + 14 plan + 147 stream + 75 composer) inside 260px —
**~6px slack, no overlap**. The work area is a flex *width* (43%), so its
preview canvas gets the full ~195px height: the ~89px page fits. Below 900px
the grid becomes 2-up and below 560px single-column with auto row heights.

**Contrast:** no colour literal was added to the hero (`home.css:1–186` has zero
hex/rgba — light guard C1 PASS). Every new/updated text colour is
`var(--ink)`, `var(--dim)` or `var(--accent)` from the shared theme tokens, so
light mode stays light and dark mode stays dark (`hero-light` B/C/D PASS).
Lime gear + black mark are unchanged.

```
cd website && npx tsc --noEmit          → PASS (no output)
cd website && npm run build             → PASS (Next 16.4.6, 14/14 static pages)
node tests-v1142-hero-panels.mjs        → 20 PASS / 0 FAIL
node tests-v1141-hero-visual.mjs        → 19 PASS / 0 FAIL
node tests-v1142-hero-light.mjs         → 15 PASS / 0 FAIL
node tests-v1138-graphics-guard.mjs     → 27 PASS / 0 FAIL
CSS brace balance                       → 0 for all three edited sheets
```

No `Math.random`, `new Date`, `Date.now`, gradient, shadow, blur or glow was
introduced; the one-cursor invariant and all determinism / RTL guards are green.
