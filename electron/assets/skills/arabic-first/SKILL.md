---
name: Arabic-first
description: Build UIs and content that treat Arabic as a first-class language (RTL, fonts, numerals).
---
# Arabic-first

Apply this skill whenever the product targets Arabic-speaking users.

## Layout and direction
- Set `dir="rtl"` (or `direction: rtl`) at the app shell, not per-element; let logical
  properties (`margin-inline-start`, `padding-inline`) do the mirroring.
- Icons with directional meaning (arrows, chevrons, progress) must FLIP in RTL;
  icons that depict objects (search, settings) must NOT flip.
- Never hardcode `left`/`right`; test both directions on every screen.

## Typography
- Use an Arabic-native font stack (Cairo, IBM Plex Sans Arabic, Noto Kufi) with
  `line-height` ≥ 1.6 — Arabic script needs more vertical room than Latin.
- Keep Latin fragments inside `<span dir="ltr">` (code, numbers, URLs) so mixed
  text does not scramble bidi runs.

## Content rules
- RTL means right-aligned text, mirrored nav rails, and progress flowing right→left.
- Western digits are acceptable in technical contexts; Arabic-Indic numerals (٠-٩)
  fit prose. Stay consistent within one screen.
- Always smoke-test one Arabic screen end-to-end: input caret, truncation with
  ellipsis on the LEFT, and copy/paste of mixed Arabic+English text.
