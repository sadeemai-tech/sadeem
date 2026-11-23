# Asset Credits

All assets below were downloaded on 2026-11-18 into `website/public/media/`. Every file was verified on disk (non-empty, and SVGs confirmed to begin with `<svg` or `<?xml`; JPEGs confirmed to begin with `FF D8 FF`).

## Logos — `website/public/media/logos/*.svg`

All SVGs except `groq.svg` come from **Simple Icons** (https://simpleicons.org). Simple Icons artwork is released under **CC0 1.0 Universal (public-domain dedication)**: https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md — "Simple Icons is released under CC0, with the exception of the trademarks/logos themselves, which remain the property of their respective owners." The marks depicted are trademarks of their respective companies; use them as brand references only, and respect each owner's brand guidelines.

| File | Source URL actually used | Result | License / credit note |
| --- | --- | --- | --- |
| `github.svg` | `https://cdn.simpleicons.org/github` | OK (837 B) | Simple Icons, CC0 1.0; GitHub trademark © GitHub, Inc. |
| `openrouter.svg` | `https://cdn.simpleicons.org/openrouter` | OK (699 B) | Simple Icons, CC0 1.0; mark © OpenRouter. |
| `openai.svg` | `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/openai.svg` | OK (1,570 B) | Simple Icons, CC0 1.0; OpenAI trademark © OpenAI. (cdn.simpleicons.org returned no file; jsDelivr fallback succeeded.) |
| `anthropic.svg` | `https://cdn.simpleicons.org/anthropic` | OK (296 B) | Simple Icons, CC0 1.0; Anthropic trademark © Anthropic PBC. |
| `google.svg` | `https://cdn.simpleicons.org/google` | OK (472 B) | Simple Icons, CC0 1.0; Google trademark © Google LLC. |
| `groq.svg` | `https://groq.com/favicon.svg` | OK (362 B) | Official Groq favicon/mark, taken from Groq's own site. Trademark © Groq, Inc. — use subject to Groq brand guidelines. (Not available in Simple Icons; `groq` slug returned 404 on both CDNs, so the official site asset was used.) |
| `mistral.svg` | `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/mistralai.svg` | OK (290 B) | Simple Icons "Mistral AI", CC0 1.0; mark © Mistral AI. Saved under requested filename `mistral.svg` (the `mistral` slug returned no file; `mistralai` is the catalog slug). |
| `deepseek.svg` | `https://cdn.simpleicons.org/deepseek` | OK (2,101 B) | Simple Icons, CC0 1.0; mark © DeepSeek. |
| `ollama.svg` | `https://cdn.simpleicons.org/ollama` | OK (4,784 B) | Simple Icons, CC0 1.0; mark © Ollama. |
| `vercel.svg` | `https://cdn.simpleicons.org/vercel` | OK (147 B) | Simple Icons, CC0 1.0; Vercel trademark © Vercel Inc. |
| `supabase.svg` | `https://cdn.simpleicons.org/supabase` | OK (318 B) | Simple Icons, CC0 1.0; mark © Supabase. |
| `figma.svg` | `https://cdn.simpleicons.org/figma` | OK (1,108 B) | Simple Icons, CC0 1.0; Figma trademark © Figma, Inc. |
| `blender.svg` | `https://cdn.simpleicons.org/blender` | OK (1,309 B) | Simple Icons, CC0 1.0; Blender trademark © Blender Foundation. |
| `huggingface.svg` | `https://cdn.simpleicons.org/huggingface` | OK (3,042 B) | Simple Icons, CC0 1.0; mark © Hugging Face, Inc. |
| `playwright.svg` | `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/playwright.svg` | OK (1,000 B) | Simple Icons, CC0 1.0; mark © Microsoft (Playwright). (cdn.simpleicons.org returned no file; jsDelivr fallback succeeded.) |
| `postgresql.svg` | `https://cdn.simpleicons.org/postgresql` | OK (5,220 B) | Simple Icons, CC0 1.0; PostgreSQL trademark © PostgreSQL Global Development Group. |
| `mysql.svg` | `https://cdn.simpleicons.org/mysql` | OK (3,640 B) | Simple Icons, CC0 1.0; MySQL trademark © Oracle Corporation. |
| `sqlite.svg` | `https://cdn.simpleicons.org/sqlite` | OK (1,435 B) | Simple Icons, CC0 1.0; SQLite mark © SQLite authors / public domain mark. |

**Logo download summary:** 18 of 18 requested logos are present and valid. Four needed fallback handling: `openai`, `playwright` (jsDelivr Simple Icons), `mistral` (`mistralai` slug), and `groq` (official groq.com favicon). Nothing was skipped in the end.

## Abstract / tech imagery — `website/public/media/*.jpg`

All three are real Unsplash images, downloaded from `images.unsplash.com` and verified as valid JPEG (`image/jpeg`, HTTP 200). License: **Unsplash License** — free for commercial and non-commercial use, no attribution required (credit appreciated). Full terms: https://unsplash.com/license. Photographer names were not retrieved (the CDN URLs do not carry them); the exact source URLs used are recorded below.

| File | Source URL actually used | Result | License note |
| --- | --- | --- | --- |
| `abstract-circuit.jpg` | `https://images.unsplash.com/photo-1518770660439-4636190af475?w=1600&q=80&fm=jpg` | OK (300,575 B, `image/jpeg`) | Unsplash License. Circuit-board / electronics close-up. |
| `abstract-network.jpg` | `https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600&q=80&fm=jpg` | OK (200,000 B, `image/jpeg`) | Unsplash License. Earth-at-night / global network imagery. |
| `abstract-cyber.jpg` | `https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1600&q=80&fm=jpg` | OK (351,025 B, `image/jpeg`) | Unsplash License. Abstract blue / data-security imagery. |

**Image download summary:** 3 of 3 attempted Unsplash images downloaded successfully. No URLs were invented — each URL was fetched and the returned bytes verified as a JPEG.

## General notes for the implementing agent

- The SVG files from Simple Icons use a default `fill` of each brand's brand color (e.g. `github.svg` uses `#181717`). They are transparent-background, 24×24 viewBox icons and will inherit/adapt with CSS filters or `currentColor` overrides if needed.
- The Unsplash JPEGs are ~1600px wide, suitable as section backgrounds or behind UI panels. The 200 KB `abstract-network.jpg` is the lightest; prefer it where load time matters.
- No image or logo was skipped in the final result. The only "failure" encountered was the browser screenshot capability (see `RESEARCH.md`), which is unrelated to these assets.
