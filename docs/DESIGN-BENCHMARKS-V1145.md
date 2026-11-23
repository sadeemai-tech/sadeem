# DESIGN BENCHMARKS v11.45 — ما نقلناه من المنافسين (وما لم نقلَه)
# Design benchmarks — patterns observed on competitor sites, applied to SADEEM

> طلب المؤسس: «حاول التقط صورة أو حمل صور إلهم من النت وانت انظر لها عشان تشوف تحسن».
> Founder: *"Try to take a screenshot or download inspirational images from the web and
> look at them yourself so you can see improvement."*
>
> I did: five real screenshots were downloaded and **visually opened** (they are saved
> in `docs/design-refs/`, see `OBSERVATIONS.md`). Every pattern below is tied to either
> something I actually saw in those images or a value read from that site's live
> HTML/CSS on 2026-11-23. No invented claims, no copied logos/assets.

---

## 0 — منهج الشغل / Method and limits

- Screenshots: thum.io free renderer, `https://image.thum.io/get/width/1440/<URL>`,
  saved as 1200×1200 PNG viewport captures. No local Playwright/Puppeteer available.
- Tokens: fetched the real HTML + linked CSS of each URL and counted declarations.
- Honest limits: Kilo's render contains a **cookie banner**; OpenCode's render is
  **scrolled so the headline is clipped**; thum.io is a third party, so treat the PNGs
  as evidence of *a render*, not a full-page pixel-perfect audit. Motion noted from CSS
  variables is marked as source-only, never as "I watched it move".

---

## 1 — Cursor: ضبط تحريري / editorial restraint

**URL:** https://www.cursor.com/ · image: `docs/design-refs/cursor.com.png`

**Observed:** warm off-white hero, left-aligned two-line headline with a lot of empty
space above it, exactly one black primary pill, one grey secondary pill, no badges or
orb or logo wall; a single large real-UI mock on a pale photographic backdrop. Inside
the mock, the previewed page is set in a serif while the app chrome is sans.

**Verified tokens:** `theme-color` `#f7f7f4` / `#14120b`; ink `#26251e`;
`max-w-[48ch]`, `max-w-prose`; serif stack `EB Garamond`, `Iowan Old Style`,
`Palatino Linotype`; product shadow `0 28px 70px rgba(0,0,0,.14)`; accent `#34785c`.

**Copy into SADEEM v11.45:**

1. One hero idea, one black CTA, one quiet secondary CTA. No "trusted by" strip above
   the headline, no floating chips, no gradient halo.
2. Cap the hero headline measure at ~48ch (`max-width: 48ch`) and use tight leading;
   the current display face is already `Instrument Serif` (`website/app/globals.css`),
   so keep it to **one** display line and let the mosaic be the proof object.
3. Put the contrast where it is earned: serif in *rendered content*, sans in app
   chrome — already how the hero mini-preview reads; do not spread serif into labels.
4. Give the hero mock a neutral two-layer shadow from existing `--sh-card` /
   `--sh-float` (style guide bans colored glow and new gradients).

---

## 2 — Zed: ثقة خطّية + شبكة قياس / typographic confidence + measuring grid

**URL:** https://zed.dev/ · image: `docs/design-refs/zed.dev.png`

**Observed:** a faint 1px graph-paper grid with ruler ticks down the margins; one
enormous **blue italic serif** headline centered, tiny grey body, two buttons with
keycap hints (`D`, `C`), a bordered `Ctrl + Shift + P` shortcut pill in the header, and
a three-column feature row divided by exact 1px vertical hairlines.

**Verified tokens:** `#4482f8` / `#084ccf` blue, `#dae4f8` pale blue, `#1b1e23` ink,
`#c6cad0` grey; display stack `writer` / `plexSerif`, mono `zedMono`; class
`animate-hero-rise` in HTML (source-only motion evidence).

**Copy into SADEEM v11.45:**

1. Let **one** Instrument Serif line carry the hero. Stop adding more hero labels —
   v11.44 already raised many tiny captions; the next win is *fewer* of them, not bigger.
2. Real keyboard affordances: render actual shortcuts as small keycaps next to CTAs
   (e.g. `⌘K`, `Ctrl+K`) **only where SADEEM really binds them**. Do not invent shortcuts.
3. A 1px measuring grid can be built from existing `--line-soft` / `--line` hairlines
   (no new gradient, no new CSS var — style guide §1/§6). Use it as a quiet background
   texture in one hero band, never over content.
4. Feature rows: three columns, 1px vertical dividers, bold short label + two-line
   body. That is a cheap, credible fix for "AI slop" card grids.

---

## 3 — Kilo: انضباط لون واحد + كثافة طرفية / one-accent discipline + terminal density

**URL:** https://kilo.ai/ · image: `docs/design-refs/kilo.ai.png`

**Observed:** near-black canvas, faint dot grid in hero only, white/grey type, one acid
yellow used on a handful of controls; dense bento cards with giant dark ghosted brand
logos bleeding off the edges; a real `curl -fsSL …` snippet with a yellow `$`; an
underlined-link subhead instead of hero buttons. (The cookie banner in the render is
an artifact, not a pattern to copy.)

**Verified tokens:** `#FACC15` accent; `#121212`, `#1a1a1a`, `#0b0b0b` surfaces;
`#a1a1a1` muted text; fonts Inter, Hanken Grotesk, ioskeleyMono.

**Copy into SADEEM v11.45:**

1. One accent, few appearances. SADEEM's `--acc` should mark the primary CTA, active
   state, focus ring — not decorate every card. Grey is allowed to be the majority.
2. Terminal honesty: show the **actual shipped CLI install command** in the hero
   (v11.44 already put the real commands in the CLI panel) and a real `$` prompt;
   never fake output.
3. Dense bento is fine when each card has one job and one action. Ghosted typography
   (a huge dim product name) is a legitimate texture — but SADEEM must use its own
   wordmark, never competitor logos.
4. Flat fills + 1px borders + modest radius; no colored glow. This aligns with the
   style guide's matte-glass and no-glow rules.

---

## 4 — OpenCode: تنقّل مُرقّم + بطاقات منتج داكنة / numbered rail + dark product cards

**URL:** https://opencode.ai/ · image: `docs/design-refs/opencode.ai.png`

**Observed:** monospace numbered nav `[1] Docs` … `[7] Enterprise` with no icons; huge
thin sans headline; three dark product cards with real mini-UIs and tiny dotted-
underline captions; a quiet grey logo row. (The screenshot is scrolled, so the
headline top is clipped — noted, not hidden.)

**Verified tokens:** `theme-color` `#fbfbfb` / `#0c0c0c`; `data-dark-blue="6b8fff"`;
`data-title-chars="28"`; no external stylesheet links found in the fetched HTML.

**Copy into SADEEM v11.45:**

1. Keep SADEEM's numbered `DEMO` rail — it is the same credible, installer-like
   language, and it is **already real** in the product. Do not replace it with icon soup.
2. Three product surfaces (Desktop / Terminal / Mobile) in one row, each showing a
   genuine miniature of the real shell, with tiny captions and one link each. This is
   exactly what the v11.44 hero mosaic already attempts — the benchmark is to reduce
   label noise and keep the mini-UI legible, not to add more panels.
3. Trust row: grey wordmarks, no colored logos, no "as seen in" hype.

---

## 5 — Claude Code: ورق دافئ + عمودين / warm paper + two-column hero

**URL:** https://claude.com/product/claude-code · image: `docs/design-refs/claude-code.png`

**Observed:** cream canvas, ink serif display, black pill + beige pill, a large product
mock on the right with a 1px border and soft neutral shadow, a row of eight small
rounded integration icon tiles, then a spaced-out logo row. Second thin nav row for
the product sub-navigation.

**Verified tokens:** `#faf9f5` paper, `#141413` ink, `#e3dacc` beige, `#dedcd1`
hairline, `#d97757` coral brand mark; `var(--font-anthropic-serif)`, `-sans`, `-mono`;
motion vars `--reveal-y:20px`, `--reveal-duration:1s`, `--reveal-stagger:.1s` (CSS only).

**Copy into SADEEM v11.45:**

1. A warm light theme reads as "tool, not SaaS". SADEEM already has theme tokens —
   tune the existing light canvas/beige neutrals through tokens, never hard-code hex.
2. Two-column hero: type left, real product image right. One black button + one quiet
   button. The sub-nav row pattern is useful for SADEEM's product/features pages.
3. Integration tiles: eight small equal icon tiles, one label each, real integrations
   only. No "AI-powered" badges, no emoji (style guide: lucide-react only).
4. Reveal motion: a small upward rise with a short stagger can be adopted in the
   existing cadence family, **but keep** the 150–240ms UI motion rule, the shared
   `--art-cadence` (2.8s) for cinematic hero sequences, and all three reduced-motion
   kill switches from v11.44.

---

## 6 — ما لا ننسخه / what NOT to copy

- No competitor logos, icons, wordmarks, screenshots, or exact copy. Patterns only.
- No cookie-banner overlay aesthetic from the Kilo render.
- No claims about features SADEEM has not shipped; a screenshot is not a feature list.
- No new gradients, colored glows, backdrop blur, emoji icons, or new CSS vars —
  `docs/SADEEM-STYLE-GUIDE.md` remains binding.
- thum.io renders can be stale or scrolled; verify any specific claim against the live
  URL before turning it into product copy.

---

## 7 — ملخص تنفيذي / one-line takeaway

> **Cursor** teaches restraint, **Zed** teaches typographic courage, **Kilo** teaches
> single-accent density, **OpenCode** teaches honest numbered product surfaces, and
> **Claude Code** teaches warm paper with a real product image. SADEEM v11.45 should
> keep its real mini-UI mosaic, remove label noise, and let one serif line + one CTA +
> one accent do the work.

Files: `docs/design-refs/{cursor.com,zed.dev,kilo.ai,opencode.ai,claude-code}.png`,
`docs/design-refs/OBSERVATIONS.md`, `docs/DESIGN-BENCHMARKS-V1145.md`.
