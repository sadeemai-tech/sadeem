# SADEEM DESIGN SYSTEM — STYLE GUIDE (BINDING CONTRACT FOR ALL AGENTS)

Read this file completely before touching any file. It is the single visual
law of SADEEM v10.0.0 (amended v11.8.0 — “Deep Space Precision”). The theme
values already live in `src/styles.css` (theme blocks) — you CONSUME tokens,
you never hard-code hex values in TSX.

## 0. Identity

- Name: **SADEEM** (سديم) — "the AI coding workstation that must PROVE it is done".
- Personality: Deep Technology · Precision · Intelligence · Reliability · Premium desktop software.
- NOT: a generic SaaS dashboard, a glassmorphism toy, a glowing neon toy.
- Inspiration (layout/behavior only, never copy assets): Claude Code, Codex, OpenCode.

## 1. Color tokens (already defined per theme in src/styles.css — use var(), never hex)

| Purpose | Token | Notes |
|---|---|---|
| Canvas behind everything | `--bg0` | app background |
| Recessed wells | `--bg1` | editor, terminal, sidebar rails |
| Cards / inputs / panels | `--panel` (=--bg3) | default card fill |
| Hover overlay target | `--panel2` (=--bg4) | |
| Active / strongest fill | `--bg5` | selected states |
| Hairline | `--line` / `--line-soft` / `--line-strong` | borders everywhere; 1px |
| Primary text | `--ink` | |
| Secondary text | `--dim` | meta, labels |
| Quiet text | `--faint` | hints, timestamps |
| Faintest text | `--ghost` | disabled, footnotes |
| **Accent (importance ONLY)** | `--acc` | active nav, primary button, success emphasis, focus ring, links |
| Accent hover | `--acc-hover` | |
| Text ON accent fills | `--acc-ink` | dark ink on bright-lime fills (dark themes); white ink ONLY on the inked-lemon fills of light themes (≥4.5:1 verified) |
| Secondary accent | `--acc2` | Electric Blue — secondary interactive elements |
| Agent activity | `--agent` | violet — ONLY for agent/LLM activity markers |
| Info | `--info` | informational badges |
| Success / Warning / Danger | `--ok` / `--warn` / `--bad` | functional, muted |
| Tool-call verbs | `--v-read` `--v-edit` `--v-grep` `--v-think` `--v-run` | activity chips |
| Selection | `--sel` | ::selection, list selection |
| Hover fills | `--hover` / `--hover-2` / `--active` | rows, buttons |
| Shadows | `--sh-card` / `--sh-float` / `--sh-1` / `--sh-key` | neutral black only |
| Glass fills (matte) | `--glass-bg` / `--glass-bg-strong` | = panel fills; no blur |
| Depth system (v11.8) | `--sa18-sh-ambient` / `--sa18-sh-lift` / `--sa18-hairline-hi` / `--sa18-lift-y` / `--sa18-hero-amb` | defined in tokens.css §2b |

**Shadow tokens (v11.8 — depth comes from shadows, never gradients):**
- `--sh-card` — soft TWO-LAYER ambient: `0 1px 2px` contact + `0 8px 24px`
  at very low alpha, neutral black. Resting cards.
- `--sh-float` — one step deeper (modals/menus/toasts): contact +
  `0 20px 56px -12px` + an inset 1px top light.
- `--sa18-sh-ambient` / `--sa18-sh-lift` — the same two-layer system as
  theme-independent constants (tokens.css); `--sa18-hairline-hi` is the
  barely-visible machined top edge (`inset 0 1px 0 var(--edge-hi2)`);
  `--sa18-lift-y` is the hover lift distance (-1px).
- NO box-shadow may contain `var(--acc)` or any colored glow (the legacy
  `--sh-key-acc` primary-button kick is the only pre-existing exception).

**Hard bans (automatic QA) — with exactly TWO sanctioned exceptions:**
- NO new `linear-gradient` / `radial-gradient` in any CSS you own, EXCEPT:
  **(a)** the brand logo plate (Logo); **(b)** hero/empty-state surfaces may
  use ONE very subtle 2-stop ambient gradient — a top-edge light lift of
  ≤6% alpha difference (consume it via `var(--sa18-hero-amb)`, see the
  Welcome hero band). Still NO colored glows, NO purple/iris accents, NO
  glassmorphism blur.
- NO iris/purple hexes (#6e56f8, #7c68ff, #7d6bea, #9b8cff, #a78bfa as --acc).
  Violet appears ONLY through `--agent` / `--v-think` for agent activity.
- NO backdrop-filter beyond the existing matte glass tokens (default is zero blur).
- NO emoji as UI icons — lucide-react only (strokeWidth 1.5–1.9).

## 2. Typography

- UI font: `var(--font-app)` (Inter + IBM Plex Sans Arabic fallback chain) — already set.
- Code/terminal/paths/numbers: `var(--font-mono-x)` (JetBrains Mono) via `.font-code`,
  `dir="ltr"` always for code, paths, model ids, numbers inside Arabic text.
- Scale: 11 / 12 / 13 / 14 (body) / 16 / 20 / 28 px. Section labels use `.caps`
  (uppercase, tracked — auto-disabled for Arabic by tokens.css).
- Arabic: `html[lang='ar']` gets +1px and looser line-height automatically. Never
  set `letter-spacing` on Arabic strings; never uppercase Arabic.
- Numbers: add `tnum` class; mixed bidi numbers use `.bidi-num`.

## 3. Geometry & motion

- Radius ladder only: `--radius-sm` 8px (chips/inputs) · `--radius-md` 10px
  (cards/buttons) · `--radius-lg` 16px (modals/heroes — v11.8) ·
  `--radius-pill` (pills/dots). No ad-hoc radii.
- Spacing rhythm: `--s1..--s6` (2/4/8/12/16/24). Card padding 14–16px, section gap 24px.
- Motion: `--dur-1/2/3` × `--ease-out`; 150–240ms only; no bounce; respect
  `prefers-reduced-motion` (tokens.css kill-switch) and `--motion-scale`.
- Z-ladder: chrome 10 · dock 20 · panel 30 · menu 60 · modal 75 · system 90.

## 4. Interaction rules

- Focus: `:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }` —
  keep it intact everywhere; never `outline: none` without a replacement ring.
- Every interactive element has: default / hover / focus-visible / active /
  disabled / selected states — verify your CSS covers all.
- Never convey state by color alone: pair color with icon/label/dot+text.
- RTL: use LOGICAL CSS properties (`margin-inline-start`, `inset-inline-start`,
  `border-inline-end`, `padding-inline`, `text-align: start`). Test both dirs
  mentally; components already mirror via flex + logical props.
- Empty states: centered, 1 icon (18px, --faint), 1–2 short lines, ONE real
  action button — no fake data, no lorem, no filler numbers.

## 5. Existing primitives you MUST reuse (don't reinvent)

- Buttons: `.btn` `.btn-acc` (accent) `.ibtn` (icon button) — defined in ui.tsx/styles.css.
- Stamps/badges: `.stamp`, `.glass-pill`, `.caps`, `.tnum`, `.font-code`.
- Cards: `.aurora-panel`, `.set-card`, `.hm-card` — restyle via tokens only.
- Scrollbars: `.set-scroll` pattern (thin, --line-strong thumb) — apply to new
  scroll containers.
- Toasts/dropdowns/modals already exist — restyle, do not replace machinery.

## 6. Code rules

- t(key, 'Fallback text') for ALL user-visible strings (bilingual ready); never
  concatenate translated fragments; keep `dir="auto"` on dynamic text.
- DO NOT edit: `src/store.ts`, `src/i18n.ts`, `src/lib/**`, `electron/**`,
  `src/styles.css` (root token blocks), `src/App.tsx`, `Rail/Sidebar/TitleBar/
  StatusBar/Home/Logo/themeMeta`. Your file ownership list is in your task brief.
  You MAY append a clearly-marked component-scoped section to CSS files you own.
- Keep every exported symbol and prop contract unchanged (integration depends on it).
- New CSS vars are forbidden — consume the existing tokens.

## 7. QA gates before you report done (run all, include output)

1. `npx tsc --noEmit -p tsconfig.json` → 0 errors.
2. `npm run build` → success (vite + preload).
3. `rg -n "linear-gradient|radial-gradient" <your CSS files>` → only sanctioned spots.
4. `rg -ni "6e56f8|7c68ff|7d6bea|9b8cff|iris" <your files>` → 0 hits.
5. Report: files changed (exact paths) + what you restyled/fixed + any deviation
   from this guide with justification.

## 8. v11.8 amendment — “Deep Space Precision” (shell refresh)

- **obsidian (default)** is now a true deep-space near-black with a slight
  cool blue cast (`--bg0 #0A0E14` family); hairlines are present (never
  near-invisible); `--dim` holds ≥5:1 on `--bg0`; the accent is a deeper,
  less-neon brand lime `#98D83B` (light themes: inked lemon `#4F7A10`).
- **Scrollbars:** 7px, low-alpha thumb (soft.css §3.1) — slimmer and subtler.
- **Title bar:** a consistent 40px (`h-10`); window controls are full-height
  40px targets. Full-stage surfaces must pin to `2.5rem`, not `44px`.
- **Rail:** the active view rides a rounded-8px pill with `--panel` fill,
  hairline ring, machined top edge + `--acc` left notch.
- **Status bar:** quieter voice — 11.5px base, `--faint` meta, hairline top.
- **Welcome hero:** uses the `w18-*` classes (soft.css §3.3): flat premium
  cards (`--panel` fill + `--sa18-sh-ambient` + top-edge highlight), hover
  lift `translateY(var(--sa18-lift-y))` + `--sa18-sh-lift` at 150ms, one
  sanctioned hero ambient via `--sa18-hero-amb` (exception b above).
