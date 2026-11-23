# Competitor screenshot observations — captured 2026-11-23

## Method (honest)

- No local Playwright or Puppeteer is installed (`require.resolve` failed for both), so
  screenshots came from the free third-party renderer **thum.io**:
  `https://image.thum.io/get/width/1440/<URL>` — HTTP 200, `image/png`, all five saved.
- thum.io returned **1200×1200 PNG viewport captures** for every request (I asked for
  width 1440; the service rendered/cropped to 1200×1200). I verified dimensions with
  `System.Drawing` and verified each image by opening it visually.
- These are **third-party renders, not full-page local browser captures**. What they
  show is what I describe. Where a render has an artifact, I say so.
- Design tokens below were extracted separately by re-fetching each site's **real HTML
  and linked CSS** (curl, 2026-11-23) and counting declarations. Tokens are quoted with
  their source URL; nothing is inferred beyond what is in the files.
- Note: text sizes below are **visual estimates from the images**, not CSS values.
  Only the hex values / font stacks / CSS variables are verified from source.

| name | file | size | source URL | pixels |
|---|---|---|---|---|
| Cursor | `cursor.com.png` | 397,721 B | https://www.cursor.com/ | 1200×1200 |
| Zed | `zed.dev.png` | 633,867 B | https://zed.dev/ | 1200×1200 |
| Kilo | `kilo.ai.png` | 181,092 B | https://kilo.ai/ | 1200×1200 |
| OpenCode | `opencode.ai.png` | 126,126 B | https://opencode.ai/ | 1200×1200 |
| Claude Code | `claude-code.png` | 137,899 B | https://claude.com/product/claude-code | 1200×1200 |

---

## 1. cursor.com — `cursor.com.png`

**What I actually see**

- Warm off-white canvas, near-black ink. **No gradient, no glow, no badge row** in the
  hero. Header is a thin fixed band: small wordmark left, five small nav items centered,
  then "Sign in" (plain text), "Contact sales" (thin outlined pill), "Download" (solid
  black pill). Exactly **one** black button in the whole top area.
- Hero is **left-aligned with a lot of empty space above it** (~100px of breathing room
  under the header). Headline is two lines, medium-large (~32–36px), regular weight,
  tight leading, near-black — no display serif, no stretch type. Only two CTAs: black
  "Download for macOS ⤓" and light-grey "Request a demo →".
- Below, one huge framed product mock on a pale painterly landscape image: nested
  windows (Cursor Desktop, a localhost browser preview, Cursor CLI) with genuinely tiny
  UI text. The **real interface is the visual**, not decoration. The preview page
  inside the mock is set in a serif with italic serif brand name — a quiet editorial
  contrast to the sans chrome.
- Spacing: ~28px headline→buttons, ~48px buttons→product frame; panels use exact 1px
  hairlines and rounded corners.

**Verified from source** (https://www.cursor.com/)

- `theme-color` = `#f7f7f4` (light) / `#14120b` (dark); preview text `#26251e`.
- Headline container `max-w-prose` and hero block `max-w-prose`; inner preview uses
  `max-w-[48ch]`, `font-family: var(--font-serif), Iowan Old Style, Palatino Linotype, …`.
- Serif stack in CSS: **EB Garamond** (70 declarations) and Lato (20); mono via
  `var(--font-mono)`; accent green `#34785c`; product window shadow
  `0 28px 70px rgba(0,0,0,.14), 0 14px 32px rgba(0,0,0,.1)`.
- Motion in CSS: `--duration`, `--ease-out-spring`, hover opacity transitions — the
  still image itself shows no motion.

---

## 2. zed.dev — `zed.dev.png`

**What I actually see**

- The signature is a **very light graph-paper / ruler grid**: 1px horizontal and
  vertical lines across the page plus tiny tick marks down both side margins, like an
  editor gutter measuring the page. White canvas, blue + near-black type.
- Header sits on the same grid: Zed icon + wordmark, Product/Resources carets,
  Extensions, Docs, Pricing, "Delta" with a small spark, a bordered **"Ctrl + Shift + P"**
  shortcut pill, "Sign up" with an `S` keycap, solid blue "Download" with a `D` keycap.
  Keyboard hints are part of the visual language.
- A thin news strip: centered small blue "Delta is now in public beta. Try it today. →".
- Hero is **centered**, and the entire typographic punch is one enormous **blue italic
  serif line**, "Your last next editor" (~48px). Two quiet lines of grey body copy,
  then two buttons: filled blue "Download now `D`" and white outlined "Clone source
  `C`", then one small grey availability line. No badges, no logo wall above the fold.
- Below: a three-column feature row (Fast / Agentic / Collaborative), **separated by
  exact 1px vertical hairlines**, with bold ~16px labels and 2-line body copy. Then a
  real editor screenshot (syntax colors, line numbers, diagnostics, terminal) with a
  small centred "Watch Demo" play pill.

**Verified from source** (https://zed.dev/)

- Blues `#4482f8`, `#084ccf`, pale `#dae4f8`; ink `#1b1e23`; greys `#c6cad0`,
  `#dadde2`, `#4b4646`; white `#fff`.
- Font stacks in CSS: `writer` / `writer Fallback` (the italic display face),
  `plexSerif`, `zedMono`, `var(--font-sans)`, `var(--font-mono)`.
- Hero animation class `animate-hero-rise` is present in the HTML (not visible in a PNG).

---

## 3. kilo.ai — `kilo.ai.png`

**What I actually see**

- Near-black `#121212` canvas with a **faint dot grid in the hero only**, fading out
  below. White/off-white text, grey body copy, and exactly **one accent: acid yellow**.
- Header: boxed icon+wordmark, a GitHub star count "28.0k", right side "Sign in",
  "Contact sales", yellow filled "Get Started", bordered square menu button.
- Centered hero: two-line ~50px rounded geometric sans headline "One open agent for
  every developer workflow", very tight leading. Subhead is three small grey lines
  with **underlined text links** instead of buttons. No hero button at all.
- Below is a **dense bento grid**: a large "Kilo Desktop" card with a tiny yellow BETA
  badge, a yellow "Download for Linux" button and small underlined OS links; a VS Code
  card and a JetBrains card with **giant dark ghosted logos bleeding past the card
  edge**, small white pill actions and muted secondary text; a bottom row with a CLI
  card showing a real `curl -fsSL …` snippet with a yellow `$` prompt, plus Cloud,
  Slack, and a Mobile card with a QR code.
- Artifact, stated honestly: a **cookie consent banner** overlays the bottom center
  with two yellow buttons ("Accept all" / "Reject all"). That is not a design
  recommendation — it is what the render captured.
- Cards are flat dark fills with 1px subtle borders and ~12px radius; **no colored
  glow, no glass blur**. Typography is mono-leaning and technical.

**Verified from source** (https://kilo.ai/)

- Yellow accent is **`#FACC15`** (also `#febc2e`, `#f2d16b` nearby); surfaces
  `#121212`, `#1a1a1a`, `#0b0b0b`, `#0e0e0e`; muted text `#a1a1a1`; white `#fff`.
- Font stacks: **Inter**, **Hanken Grotesk**, **ioskeleyMono** (mono), codicon.
- `theme-color` meta is `#617A91` (note: this does not match the rendered dark canvas;
  I report it as found, not as the design color).

---

## 4. opencode.ai — `opencode.ai.png`

**What I actually see**

- **Capture artifact, stated honestly:** the thum.io render is scrolled down — the top
  of the headline "The open source coding agent" is clipped. Everything below is clear.
- Left column is a **numbered monospace nav** with no icons: `[1] Docs`, `[2] Product`,
  `[3] Data`, `[4] Console`, `[5] Models`, `[6] Subscriptions`, `[7] Enterprise`, with
  generous row spacing. A tiny `< >` pair sits near the bottom of the rail.
- Main column: very large, **light-weight thin sans** headline; a two-line grey
  subhead about free models / 200+ providers.
- Three dark product cards in a row (Desktop / Terminal / Mobile), each ~340×430 in
  the capture: ghosted `opencode` wordmark over an input box, a terminal view with
  "Build · Claude Opus 5.5", a blue caret and "esc interrupt", and a dark dotted
  sphere. Captions are tiny: title with a **dotted underline**, two-line description,
  one small download/install link with a chevron.
- Then "Trusted by 22M+ developers" with a quiet grey logo row (NVIDIA, Cloudflare,
  Microsoft, GitHub, ByteDance, Revolut), then a "What is OpenCode?" section.
- Overall: white canvas, black type, dark product cards, a lot of empty white space.

**Verified from source** (https://opencode.ai/)

- `theme-color` = `#fbfbfb` (light) / `#0c0c0c` (dark); markup attribute
  `data-dark-blue="6b8fff"`; hero heading text is exactly "The open source coding
  agent" with `data-title-chars="28"`.
- No external stylesheet links were found in the fetched HTML (0 CSS files); token
  evidence here is limited to the HTML attributes above. Font/colors beyond that are
  visual estimates only.

---

## 5. claude.com/product/claude-code — `claude-code.png`

**What I actually see**

- **Warm paper** canvas (cream), ink-black type, beige secondary surfaces, hairline
  dividers, and a small coral/orange starburst in the Claude wordmark — the only
  brand color. No gradients or colored glows.
- Header: wordmark left; Product/Developers/Enterprise/Resources/Pricing with carets;
  "Login"; outlined "Contact sales"; solid black "Try Claude". A thin **second nav
  row** holds "Claude Code" left and "Explore here ⌄" right.
- Hero is two columns. Left: huge **serif** "Claude Code" on two lines, tight leading;
  three lines of body copy; solid black pill "Download for Linux" and a beige pill
  "Read documentation ↗"; small availability line. Right: a large product mock in a
  rounded card with a 1px border and a soft neutral shadow — sidebar (New, Projects,
  Artifacts, Customize, Pinned, Scheduled, Recents), a blue user bubble, monospace tool
  logs, composer with "Auto / Opus / Extra high".
- Below: centered "Other ways to use Claude Code:" then a row of **eight small rounded
  icon tiles** (Terminal, Web, iOS, Android, GitHub, VS Code, JetBrains, Slack) with
  tiny labels; then a widely spaced logo row (shopify, databricks, stripe, brex).
- Spacing is generous and symmetrical; cards use consistent radii; the product image
  carries the detail while the marketing type stays quiet.

**Verified from source** (https://claude.com/product/claude-code)

- Colors: `#faf9f5` (paper), `#141413` (ink), `#e3dacc` (beige), `#dedcd1`
  (hairline), `#d97757` (coral accent in the brand mark).
- Font stacks: `var(--font-anthropic-serif), Georgia, serif`,
  `var(--font-anthropic-sans), system-ui, sans-serif`,
  `var(--font-anthropic-mono), ui-monospace, monospace`.
- Motion variables in the live HTML/CSS: `--reveal-y:20px`, `--reveal-duration:1s`,
  `--reveal-delay`, `--reveal-stagger:0.1s`, `--word-stagger`. The PNG is a still,
  so none of this motion is claimed as observed.
