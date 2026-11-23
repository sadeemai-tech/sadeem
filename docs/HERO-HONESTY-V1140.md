# v11.40 — HERO ART & HONESTY / فن الهيرو والصدق

> حكم المؤسس: «التصميم اللي جنب بالهيرو... جسم المربعي... سيء سيء سيء مليون مرة. استبدلها بتصميم إبداعي فني مختلف... يعبر عن التطبيق بنفس أسلوبه، عن البرمجة والفايب كودي.» و «الكلام التسويق بالموقع والتطبيق يجب أن يكون حقيقي — إحنا مش أول AI agent local AI agent، هاي أول كذبة.»
>
> Founder verdict: the square box beside the hero was rejected "a million times"; replace it with original art that expresses coding / vibe-coding in SADEEM's own voice. All marketing must be literally true — SADEEM is **not** "the first local AI agent".
>
> **Line-number caveat / تنبيه:** X2 is concurrently editing the app-mock portion of `page.tsx`, so line numbers below the hero drift between commits. Numbers were captured at the final guard run; locate any string by grepping the quoted text if it has moved. The hero block itself (`LIME`, `GRAD`, `HeroEngraving`) is stable.

---

## 1. عربي — ماذا تغيّر

### ١-١ رسم الهيرو: من «اللوحة المربعة» إلى «مدار الشيفرة»

| | قبل (BEFORE) | بعد (AFTER) |
|---|---|---|
| الفكرة | لوحة قياس مربعة 576×576 بإطار مزدوج وعلامات قصّ ومسطرة، على خلفية فحمية داكنة داخل كرت (`hero-mat` بحدود وظل داخلي وحاشية داخلية). | **مدار مفتوح** بلا كرت ولا لوحة: هالة ليمونية ناعمة، أربع علامات تنصيب في الزوايا فقط، ١٢٠ تدريجاً دقيقاً، حلقات شعرية، قوسان بطيئان بعُقد تدور، وأسماء أدوات على مسارات تحريرية. |
| العلامة | لا تظهر العلامة الرسمية. | مربع #9be515 بترس أسود بثمانية أسنان (اثنان لكل محور) — مطابق لشعار `website/public/sadeem-app-logo.png`. |
| الكود | لا شيء. | `read_file()` · `edit_file()` · `dna_note()` · `run_tests()` بخط IBM Plex Mono على خطوط شعرية، مع مؤشر كود وامض. |
| الخط | — | سطر Instrument Serif واحد: `read · write · remember` — نبرة تحريرية هادئة. |
| الألوان | `#B6F24A`, `#DDE8CE`, `#F4FFE2`, `#fff`, `#1b2217`, `#10141a`, `#090b0e` | **فقط** `#9be515` و`#000000` داخل الرسم؛ كل الباقي `currentColor` في الوضعين الفاتح والداكن. |
| الوصف | `FIG. 01 — The inference core, drawn by hand in light.` | `FIG. 01 — Code orbit: the SADEEM mark, drawn by hand.` |

**مواقع التعديل (بعد التعديل):**
- `website/app/page.tsx:59-96` — بيانات CODE ORBIT (اللون الرسمي، ١٢٠ تدريجاً، عُقد المدارين).
- `website/app/page.tsx:518-846` — مكوّن `HeroEngraving` الجديد (الاسم القديم أبقيناه كـ hook اختباري ثابت؛ الرسم بالكامل جديد).
- `website/app/page.tsx:628-631` — أسماء الأدوات على المسارات.
- `website/app/page.tsx:644-654` — المربع الليموني والترس الأسود.
- `website/app/page.tsx:52-55` — وصف الشكل ثنائي اللغة.
- `website/app/home.css:31-55` — الأنماط الجديدة؛ `website/app/home.css:43` — `hero-mat` صار غلاف تموضع فقط بلا حدود أو خلفية أو ظل.
- `website/app/home.css:69-72` — الحركات (`he-drift`, `he-spin`, `he-pulse`, `co-caret`).
- `website/app/home.css:253,267-270` — إيقاف الحركة بالكامل في `prefers-reduced-motion` و`html.reduce-motion` و`data-art='off'`.

**الأمان:** لا `Date` ولا `Math.random` في الرسم — كل إحداثي مشتق من فهرس أو ثابت حرفي، فالخادم والعميل ينتجان SVG متطابقاً بايتاً ببايت. كل نصوص الكود تحمل `direction="ltr"` (مجموعات `<g direction="ltr">` داخل SVG) فلا تنقلب في وضع RTL.

### ١-٢ الصدق في التسويق

| الملف:السطر | قبل | بعد |
|---|---|---|
| `website/lib/site.ts:5-6` | `tagline: 'The coding agent that learns with you.'` — أداة التعريف «The» توحي بالتفرد/الأولوية. | `tagline: 'A local-first coding agent that learns with you.'` + تعليق يوضّح أن سديم واحد من وكلاء محليين، ليس «الأول». |

**ما بقي صادقاً ولم يتغيّر:** `Free during the public season` محفوظ حرفياً في `website/app/page.tsx:49` و`website/app/page.tsx:407` و`website/lib/site.ts:65`. لا اشتراك، لا رصيد، لا وعود «مجاني للأبد» في ملفاتي — والوصف في `site.ts` يقول صراحة «Free during the public season, no subscription».

**بحث شامل RESULT:** ملفاتي (`page.tsx` hero + `home.css` hero + `site.ts`) لا تحتوي أي ادعاء «first / the first / unbeatable / only local AI agent». الحارس `H10` يثبت ذلك.

### ١-٢-ب تدقيق حرج من X6 (بعد التسليم الأول)

| الملف:السطر | قبل | بعد | سبب التصحيح |
|---|---|---|---|
| `website/app/page.tsx:362` (وديله العربي `:363`) | `No telemetry, no account required to start — the whole agent runs on your machine.` / `بلا تتبّع ولا حساب إجباري — الوكيل كله يعمل على جهازك.` | `No telemetry — the agent runs on your machine. The app asks you to sign in before your first task; sign-in is local to your device.` / `بلا تتبّع — الوكيل يعمل على جهازك. يطلب التطبيق تسجيل الدخول قبل أول مهمة؛ وتسجيل الدخول محلي على جهازك.` | التطبيق يمنع أي استخدام قبل تسجيل الدخول عبر AuthGate (`src/App.tsx:361,406-435`)، فادعاء «لا حساب مطلوب للبدء» كذب. |
| `website/app/page.tsx:360` (العنوان) | `Your keys never leave.` / `مفاتيحك لا تغادر.` | `Your keys stay yours.` / `مفاتيحك تبقى ملكك.` | المفتاح يُرسل للمزوّد الذي تختاره كجزء من استدعاء النموذج؛ «لا يغادر» حرفياً غير صحيح. |
| `website/lib/site.ts:70` (وصف SEO لميزات) | `145 tools, 20+ MCP servers, 12 subagents, ...` | `145 tools, 16 specialist agents, optional user-configured MCP servers, ...` | العدد الحقيقي ١٦ وكيلاً (`electron/agent/agents.ts:2,31`)؛ خوادم MCP يضيفها المستخدم (`electron/agent/mcp.ts:3192`) فلا يوجد عدد ثابت «20+». |

الحارسان `H13` و`H14` يمنعان رجوع هذه الادعاءات.

### ١-٣ ادعاءات خارج ملكيتي — أُبلّغ عنها ولا أعدّلها

هذه مواد تسويقية فيها أداة تعريف توحي بالأولوية، أو عرض لا وجود له. اكتُشفت بفحص شامل، وموقعها بالضبط أدناه لتُسند إلى صاحب الملف:

| الملف:السطر | النص | لماذا فيه مشكلة |
|---|---|---|
| `website/components/home/SEOContent.tsx:25` | `a: 'The local-first AI coding agent'` | «The» = وكيل محلي أولاً بعينه/الأول — غيّرها إلى `A local-first AI coding agent`. |
| `website/components/download/DownloadPage.tsx:410` | `The local-first coding agent that learns with you...` | نفس أداة التفرد. |
| `website/docs/RESEARCH.md:120` | `The local-first, Arabic-first coding agent for Windows...` | نفس أداة التفرد + «Arabic-first» ادعاء تفوق. |
| `src/i18n.ts:214` | `Upgrade for team features and priority support` / `دعم الأولوي` | يعرض ترقية/دعم غير موجود في هذه النسخة — ادعاء كاذب صريح. |
| `README-v7.1.0.md:1,40` | `أول وكيل لا تحتاج أن تثق به` | عنوان تاريخي بادعاء «أول وكيل». |
| `website/components/home/SEOContent.tsx:82,119` | `catalog of 20+ servers` / `20+ install-ready MCP servers` | عدد MCP غير قابل للتحقق؛ الخوادم يضيفها المستخدم. |
| `website/app/layout.tsx:49,78` | `Curated catalog of 20+ MCP servers` | نفس المشكلة في keywords وFAQ JSON-LD. |
| `website/docs/RESEARCH.md:51,79,99,126,128,161,162` | `12 subagents` / `20+ MCP servers` | أرقام خاطئة (الصحيح ١٦ وكيلاً). |
| `src/i18n.ts:886,1086` | `all 12 subagents` / `12 subagents & plan mode` | أرقام خاطئة داخل التطبيق نفسه. |

> ملاحظة: العبارات الصادقة مثل `A local-first agent...` في `website/components/chrome.tsx:95` و`LOCAL-FIRST CODING AGENT` في `website/components/home/HomeContent.tsx:207` سليمة — أداة نكرة/وصف فئة، لا ادعاء أولوية.

---

## 2. English — what changed

### 2.1 Hero artwork: from the "boxy plate" to the Code Orbit

| | BEFORE | AFTER |
|---|---|---|
| Concept | A 576×576 square measurement plate: double rule, crop marks, ruler, grain filter, dark charcoal mat with border / inset shadow. | An **open orbit**, no card at all: soft lime halo, four open corner ticks, 120 precise dial graduations, concentric hairlines, two slow counter-rotating arcs with riding nodes, and tool names on editorial rails. |
| Mark | Official logo absent. | Official lime `#9be515` square with the black 8-tooth gear (two teeth per axis), faithful to `website/public/sadeem-app-logo.png`. |
| Code | none. | `read_file()` · `edit_file()` · `dna_note()` · `run_tests()` in IBM Plex Mono on hairline rails, plus a blinking caret. |
| Type | — | One Instrument Serif line: `read · write · remember` — calm, editorial. |
| Paint | `#B6F24A`, `#DDE8CE`, `#F4FFE2`, `#fff`, `#1b2217`, `#10141a`, `#090b0e`. | **Only** `#9be515` + `#000000` inside the artwork; everything else is `currentColor` so it reads in both themes. |
| Caption | `FIG. 01 — The inference core, drawn by hand in light.` | `FIG. 01 — Code orbit: the SADEEM mark, drawn by hand.` |

**Exact locations (post-change):**
- `website/app/page.tsx:59-96` — CODE ORBIT data (official lime/black, 120 graduations, orbital nodes).
- `website/app/page.tsx:518-846` — new `HeroEngraving` component (historical name retained as a stable test hook; the drawing itself is entirely new).
- `website/app/page.tsx:628-631` — tool names on the rails; `website/app/page.tsx:644-654` — lime square + black gear.
- `website/app/page.tsx:52-55` — bilingual figure caption.
- `website/app/home.css:31-55` — new hero styles; `website/app/home.css:43` — `.hero-mat` is now a plain positioning wrapper (no border, background or inset shadow).
- `website/app/home.css:69-72` — motion keyframes; `website/app/home.css:253,267-270` — reduced-motion + manual kill switches cover all five animated classes.

**Safety:** no `Date` / `Math.random` — every coordinate is index-derived or literal, so SSR and first client frame are byte-identical. All code strings sit in `<g direction="ltr">` groups inside the SVG so they never flip in RTL.

### 2.2 Honesty

| File:line | BEFORE | AFTER |
|---|---|---|
| `website/lib/site.ts:5-6` | `tagline: 'The coding agent that learns with you.'` — "The" implies a unique/first agent. | `tagline: 'A local-first coding agent that learns with you.'` with a comment stating SADEEM is one local-first agent among many. |

**Kept honest, unchanged:** `Free during the public season` remains verbatim at `website/app/page.tsx:49`, `website/app/page.tsx:407` and `website/lib/site.ts:65`. No subscription / credits / "free forever" promise was introduced in owned files.

**Full-repo grep result:** no `first local AI agent`, `the first`, `world's first`, `unbeatable` or `unlimited forever` claim exists in the owned hero/site copy — guard check `H10` proves it.

### 2.2b Critical audit from X6 (after first delivery)

| File:line (snapshot) | BEFORE | AFTER | Why |
|---|---|---|---|
| `website/app/page.tsx:362` + Arabic `:363` | `No telemetry, no account required to start — the whole agent runs on your machine.` / `بلا تتبّع ولا حساب إجباري — الوكيل كله يعمل على جهازك.` | `No telemetry — the agent runs on your machine. The app asks you to sign in before your first task; sign-in is local to your device.` / `بلا تتبّع — الوكيل يعمل على جهازك. يطلب التطبيق تسجيل الدخول قبل أول مهمة؛ وتسجيل الدخول محلي على جهازك.` | An AuthGate (`src/App.tsx:361,406-435`) blocks all use before sign-in, so "no account required to start" was a lie. |
| `website/app/page.tsx:360` (pillar title) | `Your keys never leave.` / `مفاتيحك لا تغادر.` | `Your keys stay yours.` / `مفاتيحك تبقى ملكك.` | The key is transmitted to the chosen provider as part of the model call; "never leaves" is literally wrong. |
| `website/lib/site.ts:70` (features SEO description) | `145 tools, 20+ MCP servers, 12 subagents, ...` | `145 tools, 16 specialist agents, optional user-configured MCP servers, ...` | 16 agents (`electron/agent/agents.ts:2,31`); MCP servers come from user settings (`electron/agent/mcp.ts:3192`), so no fixed "20+" exists. |

Guards `H13` and `H14` prevent regression.

### 2.3 Out-of-ownership claims — reported, not edited

| File:line | String | Problem |
|---|---|---|
| `website/components/home/SEOContent.tsx:25` | `a: 'The local-first AI coding agent'` | Definite article implies *the* / *first* local AI agent → use `A local-first AI coding agent`. |
| `website/components/download/DownloadPage.tsx:410` | `The local-first coding agent that learns with you...` | Same uniqueness claim. |
| `website/docs/RESEARCH.md:120` | `The local-first, Arabic-first coding agent for Windows...` | Same, plus an "Arabic-first" superiority claim. |
| `src/i18n.ts:214` | `Upgrade for team features and priority support` / `دعم الأولوي` | Advertises a paid tier/support that does not exist in this release. |
| `README-v7.1.0.md:1,40` | `أول وكيل لا تحتاج أن تثق به` | Historical "first agent" headline. |
| `website/components/home/SEOContent.tsx:82,119` | `catalog of 20+ servers` / `20+ install-ready MCP servers` | MCP server count is user-configured, not a shipped fixed number. |
| `website/app/layout.tsx:49,78` | `Curated catalog of 20+ MCP servers` | Same problem in keywords + FAQ JSON-LD. |
| `website/docs/RESEARCH.md:51,79,99,126,128,161,162` | `12 subagents` / `20+ MCP servers` | Wrong counts (correct: 16 agents). |
| `src/i18n.ts:886,1086` | `all 12 subagents` / `12 subagents & plan mode` | Wrong counts inside the app itself. |

> Honest phrasing elsewhere is fine and was left alone: `A local-first agent...` (`website/components/chrome.tsx:95`) and `LOCAL-FIRST CODING AGENT` (`website/components/home/HomeContent.tsx:207`) are category descriptions, not first-of-kind claims.

---

## 3. Verification / التحقق

```
node tests-v1140-hero-honesty.mjs     → 14 PASS / 0 FAIL / 19 WARN (WARN = out-of-ownership, listed above)
npx tsc --noEmit                      → clean at 13:19 after both X6 fixes
npm run build                         → ✓ Compiled successfully; 14 static pages (13:19 run)
node tests-homepage-seo.mjs           → 8 PASS / 0 FAIL / 1 WARN
                                         W1: 35 circles, 17 lines, 24 paths, 7 rects in the new hero SVG
```

**Integration blocker (not mine):** after 13:19, X2's in-flight refactor of the app-mock `beat()` helper left the repo-wide `tsc`/`build` red at `page.tsx:951-1048` (`string` vs `number` mismatch on `style={beat(...)}` calls). All of those lines are in X2's app-mock section; the hero, BENEFITS fix, CSS and `site.ts` are error-free. Do not attribute that break to this workstream.

The new guard is `tests-v1140-hero-honesty.mjs` (repo root). It enforces: art mounted, no box/plate/grain fragments, palette limited to `#9be515` + `#000000`, no box-painting `.hero-mat`, all five animated classes under every kill switch, RTL text hooks, hydration determinism, honest tagline, preserved "free during the public season", an honest figure caption, the real sign-in gate (H13), and the real 16-agent / user-configured-MCP counts (H14). Out-of-scope claims are printed as WARN with exact file:line — they do NOT fail this guard because those files belong to other workstreams.

**Caveat / تحذير منهجي:** this is a source-level guard. It can prove what is in the SVG markup and CSS, but it cannot see rendered pixels. The founder's eye on a real screenshot remains the final judge of beauty.

## 4. Ownership / الملكية

Edited only: `website/app/page.tsx` (hero + its art, plus the two X6-mandated honesty lines in BENEFITS item 01 at ~360-373 — the app-mock section was untouched), `website/app/home.css` (hero section + shared kill-switch lists only), `website/lib/site.ts` (tagline + features SEO description only). Created: `tests-v1140-hero-honesty.mjs`, this document. No other file was modified.
