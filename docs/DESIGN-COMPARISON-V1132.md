# DESIGN COMPARISON — SADEEM v11.32 against the Codex-class competitor
# مقارنة التصميم — سديم v11.32 مقابل منافس من فئة Codex

> **Diagnosis + test only — NO app source edits were made by this document.** Parent dispatches the fixes.
> **تشخيص + اختبار فقط — لم يعدّل هذا المستند أي ملف من ملفات التطبيق. الوالد (parent) هو من يوزّع الإصلاحات.**
>
> **As-of:** 2026-11-21 (local). Workspace `sadeem-v11.12.0`. All `file:line` references are to this exact tree.
> **Method:** direct source reads + `grep` verification (§5). I did **not** see the founder's screenshots as pixels — the founder's descriptions in the brief are treated as ground truth, and every visual element is traced back to the exact CSS/TSX that produces it.
> **المنهج:** قراءة مباشرة للمصدر + تحقق عبر grep (§5). لم أرَ لقطات المؤسس كبكسلات — أوصافه في التكليف تُعدّ هي المرجع، ونُسب كل عنصر بصري إلى ملف CSS/TSX الدقيق الذي ينتجه.

---

## 0. Brutal verdict first — الحكم الصريح أولاً

**EN:** The competitor's polish is *not* mostly a "theme". It is a **density and chrome discipline**. SADEEM already has the clean part: the Welcome hero is a centered Instrument Serif headline on generous whitespace (`Welcome.tsx:177-208`, `soft.css:221-240`), and the preview surface is already calm (`preview.css:1-147`). The regression is **entirely in the chat transcript**: almost every tool call is a bordered, shadowed card; every failed tool result ends in a full-width lime-green action bar; expanding a tool shows a key/value table with bordered code boxes. That is what makes the founder's build look "boxed and dense" next to Codex. These are **real design defects**, not taste differences. Details in §4.

**AR:** تلميع المنافس ليس في الغالب "ثيماً"، بل هو **انضباط في الكثافة والحواف**. سديم يملك بالفعل الجزء النظيف: شاشة الترحيب عنوان Serif مركّز على مساحة بيضاء سخية (`Welcome.tsx:177-208`، `soft.css:221-240`)، وسطح المعاينة هادئ أصلاً (`preview.css:1-147`). التراجع **كله داخل سجل المحادثة**: كل استدعاء أداة تقريباً بطاقة ذات حدود وظل؛ وكل نتيجة أداة فاشلة تنتهي بشريط إجراء أخضر عريض؛ وتوسيع الأداة يُظهر جدول مفتاح/قيمة بصناديق كود ذات حدود. هذا بالضبط ما يجعل بناء المؤسس يبدو "مُغلّفاً ومزدحماً" مقارنةً بـ Codex. هذه **عيوب تصميم حقيقية**، لا اختلاف ذوق. التفاصيل في §4.

---

## 1. Side-by-side table — جدول المقارنة جنباً إلى جنب

| Element / العنصر | SADEEM current — exact source | Competitor (Codex-style) | Defect? / عيب؟ |
|---|---|---|---|
| **Chat rows / صفوف المحادثة** | `.chat-stream` padding `14px 18px 24px`, gap `18px` — `src/components/chat.css:209-212`; measure `max-width:720px/980px` centered — `chat.css:82-93`; assistant gutter `YOU/SADEEM · time` uppercase 10px — `chat.css:223-241`, `MessageView.tsx:3090-3103`; user bubble `max-width:85%`, 1px accent hairline + `radius:10px` + `box-shadow:var(--sh-1)` — `chat.css:307-335`, `MessageView.tsx:2955-2985`; quiet completion line — `chat.css:788-801`. | Near-white/dark canvas, huge whitespace, one centered serif headline, message text with no per-row chrome. / لوحة بيضاء/داكنة، مساحة بيضاء ضخمة، عنوان Serif مركّز، نص رسائل بلا حواف لكل صف. | **Mixed / مختلط.** Gutter + bubble are defensible identity; the *volume* of rows (gutter, stamps, action bar, done row, feedback thumb) is heavier than competitor. / الهامش والفقاعة هويّة مقبولة، لكن *كثافة* الصفوف أثقل. |
| **Tool cards / بطاقات الأدوات** | `.tl2-card` = `border:1px solid var(--line-soft); border-radius:8px; background:color-mix(...panel 62%)` — `chat.css:872-883`; header padding `5px/8px` — `chat.css:923-930`; 20px icon chip with inset ring `chat.css:933-943`; tinted error/denied boxes `chat.css:888-895`; **additional** hover `box-shadow:var(--sh-card)` + `translateY(-1px)` + accent `::before` bar — `src/components/console.css:64-97`; stack/diff/exit/badge chips — `MessageView.tsx:2793-2834`. | Tool calls are quiet single rows: verb + target + status, no border, no fill, no lift. / استدعاءات الأدوات صفوف هادئة: فعل + هدف + حالة، بلا حدود أو تعبئة أو رفع. | **YES — P0 defect / نعم — عيب P0.** This is the single biggest visual gap. / هذه أكبر فجوة بصرية. |
| **Error display / عرض الأخطاء** | Assistant error = bordered tinted card `.error-card` — `chat.css:342-348`, `MessageView.tsx:3031-3037`. Tool failure = `.sc18-res` border-top + red tint — `chat.css:1198-1202, 1242-1247`; **then** a `width:100%` full-width green action bar `.sc18-res-explain` with `color:var(--acc)` (lime #98D83B / #4F7A10) and a top hairline — `chat.css:1271-1293`; label `tool.explainError` — `src/i18n.ts:2206`; rendered by `ResultRow` — `MessageView.tsx:1796-1862` (button `1847-1859`, handler `1814-1825`); `ResultRow` is mounted **for every tool call** at `MessageView.tsx:2899` and standalone at `2990-2995`. | One quiet error line; no repeated full-width CTA on every failed tool. / سطر خطأ هادئ واحد؛ لا زر CTA عريض متكرر بعد كل أداة فاشلة. | **YES — P0 defect / نعم — عيب P0.** The repetition is structural, not cosmetic; see §2 P0-2. / التكرار بنيوي لا تجميلي. |
| **ARGUMENTS / PATH / CONTENT tables / جداول الوسائط** | Expanded drawer `.sc18-drawer` — `chat.css:1050-1054`; `.sc18-args` column with `gap:6px` — `chat.css:1061-1067`; **label** `.sc18-arg-k` = uppercase 9.5px, `min-width:72px`, `max-width:34%` (reads as a table header column) — `chat.css:1077-1089`; **value** `.sc18-arg-v` mono 11.5px — `chat.css:1090-1098`; multi-line `content` in bordered code box `.sc18-arg-pre` (`border:1px`, `radius:6px`, `max-height:200px`) — `chat.css:1119-1136`; copy button chip — `chat.css:1169-1190`; TSX builder `ArgValue`/`PrettyArgs` — `MessageView.tsx:1909-2048`, drawer mount `2856-2893`. | Zero argument tables by default — a single quiet summary row; details only on demand and without a boxed grid. / صفر جداول وسائط افتراضياً — صف ملخّص هادئ واحد؛ التفاصيل عند الطلب فقط وبدون شبكة مُغلّفة. | **YES — P1 defect (expanded state) / نعم — عيب P1 (حالة التوسيع)**. Collapsed-by-default (`MessageView.tsx:2587`) limits the damage, but when a founder expands one he sees exactly the dense table in the screenshot. / الطي الافتراضي يقلّل الضرر، لكن عند التوسيع يظهر الجدول الكثيف نفسه. |
| **Composer / حقل الإدخال** | `.composer-dock-v13` padding `6px 14px 14px` — `console.css:634-636`; `.composer-card-v13` = `border:1px solid var(--line)`, `radius:var(--v13-r-card)`, `background:var(--bg3)`, `padding:12px 13px 11px !important` — `console.css:637-645` (overrides the glow shadow at `chat.css:1580-1589`); segmented mode chip strip BUILD/PLAN/DEBUG/REVIEW with active accent fill — `console.css:652-678`, `Composer.tsx:1884-1932`; input min-height 46px — `console.css:680-687`, `Composer.tsx:1991`; icon buttons + 34px send — `console.css:689-711`, `chat.css:1764-1791`; key hints + agent/context chips — `Composer.tsx:2157-2169`, `console.css:713-723`; worktree chip in the same row — `WorktreeChip.tsx:107-125`. | Minimal bottom composer: one input line, one send control, near-zero chrome. / حقل سفلي بسيط: سطر إدخال واحد، زر إرسال واحد، حواف شبه معدومة. | **Partly / جزئياً.** The v13 card already dropped the glow, but the mode-segment strip + tool row + hints + worktree chip is still a control panel, not a quiet composer. / بطاقة v13 أزالت الوهج، لكن شريط الأوضاع + صف الأدوات + التلميحات + شجرة العمل لا تزال لوحة تحكم. |
| **Sidebar / الشريط الجانبي** | Live navigation is a **full-width 44px horizontal rail under the title bar** — `src/components/Rail.tsx:1-9`, `.app-rail-bar-v13` `height:44px`, `border-bottom`, `background:var(--bg1)` — `src/components/shell.css:132-152`; buttons `rail-bar-btn` — `shell.css:179-200`; non-Home views are full-page stage rails in the right dock; the legacy resizable drawer is an unused fallback — `src/components/Sidebar.tsx:1-8, 18-38`. | Left sidebar: compact conversation list + a "new chat" affordance; very little chrome. / شريط جانبي أيسر: قائمة محادثات مضغوطة + زر محادثة جديدة؛ حواف قليلة جداً. | **Not a defect — different IA / ليس عيباً — بنية معلومات مختلفة.** SADEEM trades a chat list for 15+ work surfaces (git, MCP, flows, wiki, skills…). Copying the left sidebar would *remove* capability. / سديم يستبدل قائمة المحادثات بأكثر من 15 ساحة عمل؛ نسخ الشريط الأيسر سيلغي قدرات. |
| **Preview / المعاينة** | Already clean: no gradients/glows, hairline toolbar `.pv2-bar`, hairline "built" band `.pv2-built`, quiet progress `.pv2-loading`, single hairline error card — `src/components/preview.css:1-147`; serif `.pv-title` — `src/components/chat-final.css:198-207`; auto-open on build. | Beautiful large rendered preview occupying the right half. / معاينة كبيرة جميلة تشغل النصف الأيمن. | **No defect / لا عيب.** If the founder's screenshot looks cramped, cause is the *dock width*, not the preview CSS. Keep it. / إذا بدت المعاينة ضيقة فالسبب عرض الرصيف (dock) لا CSS المعاينة. ابقِها. |
| **Worktree table / جدول أشجار العمل** | Composer chip + popup list: `.wt-chip` pill `radius:999px` — `chat.css:2559-2569`; `.wt-menu` `width:300px`, `radius:8px`, `box-shadow:0 12px 32px rgba(0,0,0,.35)` — `chat.css:2570-2577`; rows `.wt-row` — `chat.css:2580-2590`; full worktree list in Workspace panel as `.keyrow` rows with 3 icon buttons — `src/components/panels/WorkspacePanel.tsx:1045-1089`; current-tree lime keyline `.wt-current` — `src/components/workspace.css:671-676`. | Simple flat table of worktrees with branch/status columns. / جدول مسطّح بسيط لأشجار العمل مع أعمدة الفرع/الحالة. | **Not a defect — cosmetic / ليس عيباً — تجميلي.** The menu's heavy drop shadow (`chat.css:2574`) is the only genuinely "un-Codex" detail; the table itself is already quiet. / الظل الثقيل للقائمة هو التفصيل الوحيد المختلف فعلاً؛ الجدول نفسه هادئ. |

---

## 2. Ranked change list — القائمة المرتّبة للتغييرات

> **DO NOT EDIT — these are dispatch instructions for the parent.** Selector + property only; exact values are proposals, not applied edits.
> **لا تُعدّل — هذه تعليمات توزيع للوالد.** المحدّد + الخاصية فقط؛ القيم المقترحة ليست تعديلات مطبّقة.

### P0 — do these first / نفّذ هذه أولاً

**P0-1 — Make tool calls quiet rows, not cards / حوّل استدعاءات الأدوات إلى صفوف هادئة لا بطاقات**
- `src/components/chat.css:875` — `.tl2-card { border: … }` → `border: 0; border-bottom: 1px solid var(--line-soft);` (keep one hairline as a row separator).
- `src/components/chat.css:876` — `.tl2-card { border-radius: 8px }` → `border-radius: 0`.
- `src/components/chat.css:877` — `.tl2-card { background: color-mix(...) }` → `background: transparent`.
- `src/components/console.css:74-75` — `.tl2-card:hover { box-shadow: var(--sh-card); transform: translateY(-1px); }` → **delete both declarations** (the lift is the anti-Codex tell).
- `src/components/console.css:77-97` — `.tl2-card::before` accent bar → remove or drop opacity to `0` permanently.
- `src/components/chat.css:933-943` — `.sc18-tico` 20px chip + `box-shadow: inset 0 0 0 1px …` → drop the inset ring and reduce to ~14px; keep the hue on the verb text so state never rides on colour alone.
- `src/components/chat.css:888-895` — keep error/denied tints but drop the border, keep the tint as a left keyline instead.
- TSX reference, do not restructure: `MessageView.tsx:2756-2762` (card markup), `2793-2834` (chips). Collapsed-by-default at `MessageView.tsx:2587` is correct — keep it.

**P0-2 — Kill the repeated green "Explain this error and fix it" bars / أزل تكرار الأشرطة الخضراء**
- `src/components/MessageView.tsx:2899` — `{result && <ResultRow result={result} />}` renders a full result (and its explain CTA) for **every** tool call. Gate the explainer to **one per turn/group** (e.g. only the first failed result in a run group, or surface it in the single run/timeline strip) rather than in each `ResultRow`.
- `src/components/MessageView.tsx:1847-1859` — the `{!ok && <button className="sc18-res-explain">…}` block: keep the capability, change presentation.
- `src/components/chat.css:1271-1285` — `.sc18-res-explain { width:100%; border-top:1px solid …; color:var(--acc) }` → `width:auto; border-top:0; color:var(--dim); font-size:10px; padding:2px 0` — a quiet text link, not a full-width lime bar. On hover only, `color:var(--ink)` (`chat.css:1287-1289` stays conceptually).
- `src/components/chat.css:1242-1247` — `.sc18-res.is-bad` red fill: reduce to a 2px left keyline only.
- Keep the i18n key `tool.explainError` (`src/i18n.ts:2206`) and the bilingual label; **do not remove the feature** — it is genuinely unique (§3).

**P0-3 — De-noise the error card / قلّل ضجيج بطاقة الخطأ**
- `src/components/chat.css:343-348` — `.error-card { border:1px …; background:color-mix(7%…); box-shadow:var(--sh-1) }` → `border-left:2px solid var(--bad); border:0; background:transparent; box-shadow:none` — honest text, no box.

### P1 — next / ثم

**P1-4 — Flatten the expanded args table / مسطّح جدول الوسائط عند التوسيع**
- `src/components/chat.css:1077-1089` — `.sc18-arg-k { text-transform:uppercase; min-width:72px; max-width:34%; letter-spacing:.09em }` → drop uppercase/min-width; use `font-size:10px; color:var(--ghost)` with no fixed column — it stops reading as a table header.
- `src/components/chat.css:1119-1136` — `.sc18-arg-pre { background:var(--bg2); border:1px solid var(--line-soft); border-radius:6px }` → `background:transparent; border:0; border-left:1px solid var(--line-soft); border-radius:0`, keep the clamp.
- `src/components/chat.css:1169-1190` — `.sc18-arg-copy` chip → borderless, icon-only until hover.
- `src/components/chat.css:1050-1067` — `.sc18-drawer/.sc18-args` → reduce `gap` and padding by ~30–40% so the drawer reads as rows, not a grid.
- TSX: `MessageView.tsx:1910-2048` — keep typed values, copy buttons and "Show all" clamps; only presentation changes.

**P1-5 — Lighten the composer / خفّف حقل الإدخال**
- `src/components/console.css:637-645` — `.composer-card-v13` → `border:1px solid var(--line-soft); background:var(--bg1); padding:8px 10px`; keep `border-radius` (the one generous corner is fine).
- `src/components/console.css:652-678` — `.composer-modes-v13` segmented strip → a single quiet label + caret; if kept, drop `box-shadow: inset 0 0 0 1px …` at `:671` and the accent fill at `:668-670`.
- `src/components/console.css:634-636` — `.composer-dock-v13` → reduce bottom padding.
- `src/components/chat.css:321-335` — `.sc-userbody` bubble `box-shadow:var(--sh-1)` → `none`; keep hairline + radius for identity.
- `src/components/chat.css:2574` — `.wt-menu box-shadow:0 12px 32px rgba(0,0,0,.35)` → `var(--sh-1)` or none (flat panel).

**P1-6 — If whitespace is the complaint, fix the dock, not the CSS tokens / إن كانت المساحة هي الشكوى، أصلح عرض الرصيف لا الرموز**
- `src/components/chat.css:82-93` — `data-chatwidth` cozy `720px` / wide `980px` is already a centred measure; increasing it and/or widening the preview dock yields the competitor's "huge canvas" without touching design tokens.
- `src/components/chat.css:209-212` — `.chat-stream` padding/gap may go up slightly **only after** P0-1 lands; adding whitespace around boxed cards makes them look more boxed, not less.

---

## 3. Do NOT copy — and what SADEEM already does better
## 3. ما لا يُنسخ — وما يتفوّق فيه سديم أصلاً

### Do NOT copy the competitor's / لا تنسخ من المنافس
- **Cloud subscription / paywall** — SADEEM is local-first and works with your own keys and files. A cloud subscription would be a regression, not polish.
- **English-only / no bilingual UI** — SADEEM's AR/EN pair with RTL logical properties (`chat.css` uses `margin-inline-*`, `inset-inline-*`, `[dir=rtl]` overrides throughout; `shell.css:145-152, 168`) is a hard-won asset. The competitor has nothing equivalent.
- **Fewer tools / thinner agent** — SADEEM ships **145 tools**, a playbook, verification/proof gates, before/after diffs and worktree hand-off. "Minimal" on their side is partly "does less". Copy the *calm*, never the *capability loss*.
- **No local file/terminal execution, no repo isolation** — do not trade these away for a prettier canvas.
- **The serif headline** — SADEEM already has it (`display-type.css:47-67`, `soft.css:221-234`, `chat-final.css:198-207`); there is nothing to copy.

### SADEEM already does better / سديم يتفوّق أصلاً
- **Local-first** — no cloud lock-in; the worktree table (`WorkspacePanel.tsx:1045-1089`) and run-here hand-off (`WorktreeChip.tsx:19-226`) are real isolation, not decoration.
- **Bilingual + RTL** — every new rule must stay logical-property clean; this is a moat.
- **145 tools + playbook + proof/diff receipts** — the "explain the error" coach (`MessageView.tsx:1814-1825`, `i18n.ts:2206`) is a *teaching* feature the competitor does not have. Fix its **presentation** (P0-2), never delete the capability.
- **Honest state** — `data-status` on one source of truth (`MessageView.tsx:2738-2744`), copy buttons that actually write (`useCopyFeedback` at `MessageView.tsx:2580-2582`), no false "Copied".
- **Reduced-motion discipline** — `preview.css:106-109`, `art.css:249-289`, `chat.css:2551-2553`. Keep it.

---

## 4. Brutal honesty — الصراحة الحاقدة

| Claim / الادعاء | Honest verdict / الحكم الصادق |
|---|---|
| "Boxed tool cards" | **TRUE and a real defect.** `chat.css:875-877` + `console.css:71-97` literally draw a bordered, filled, hover-lifting card for *every* tool call. That is the opposite of a quiet row. / صحيح وعيب حقيقي. |
| "Repeated green buttons" | **TRUE and the worst defect.** It is not one button styled green: it is one button **mounted per failed tool result** (`MessageView.tsx:2899`) with `width:100%` and `color:var(--acc)` (`chat.css:1273,1283`). Ten failing calls = ten lime bars. Structural, embarrassing, and entirely fixable. / صحيح وهو أسوأ عيب؛ عشر أدوات فاشلة = عشرة أشرطة خضراء. |
| "Dense ARGUMENTS/PATH/CONTENT tables" | **TRUE in the expanded state.** The uppercase `min-width:72px` key column (`chat.css:1077-1089`) plus bordered `content` pre (`chat.css:1119-1136`) is exactly a table. Collapsed-by-default softens it; it does not excuse it. / صحيح عند التوسيع؛ الطي الافتراضي يخفّفه لكن لا يبرّره. |
| "Composer should be minimal" | **Partly fair.** The v13 composer already removed the glow (`console.css:642`). What remains is honest control density (modes, tools, hints, worktree). Trimming is right; deleting bilingual mode labels or the worktree picker to chase whitespace would be wrong. / مقبول جزئياً؛ التقليم صحيح، والحذف من أجل المساحة خطأ. |
| "Sidebar should look like competitor's" | **Unfair.** SADEEM deliberately has a top rail + stage pages because it has 15+ surfaces. Do not flatten it into a chat list. / غير منصف. |
| "Preview should look like competitor's" | **Mostly unfair.** `preview.css` is already hairline-flat and calm. Any gap is dock width (P1-6), not styling. / غير منصف في الغالب. |
| "Worktree table should be simpler" | **Marginal.** Only the menu drop shadow (`chat.css:2574`) is off-brand. The Workspace table is already quiet rows. / هامشي. |
| "Just re-theme it" | **False.** Tokens (`styles.css`, `tokens.css`) are consistent and deliberate. The problem is **component-level chrome and repetition**, not colour. / خطأ؛ المشكلة في حواف المكوّنات وتكرارها لا في الألوان. |

**One-line truth / الحقيقة في سطر:** SADEEM looks less polished than Codex because it draws a box and a green CTA for nearly every tool event; remove those two habits (P0-1, P0-2) and 80% of the visual gap closes without losing a single capability.
**الحقيقة:** سديم يبدو أقل تلميعاً لأنه يرسم صندوقاً وزراً أخضر لكل حدث أداة تقريباً؛ أزل هاتين العادتين ويُغلق 80٪ من الفجوة البصرية دون خسارة أي قدرة.

---

## 5. Source verification (test-only evidence) — التحقق من المصدر (دليل اختباري)

The following `grep` checks were run against this tree; results confirmed the cited lines. No source file was modified.

| Check / الفحص | Result / النتيجة |
|---|---|
| `grep -n "Explain this error and fix it" src` | `src/i18n.ts:2206`, `src/components/MessageView.tsx:1857` ✔ |
| `grep -n "ARGUMENTS\|PATH\|CONTENT" src/components/MessageView.tsx` | `ARG_PATH_KEYS` at `:1897`, path classification `:1904` ✔ |
| `grep -n "className=\"tl2-card" src/components/MessageView.tsx` | card markup at `:2757` ✔ |
| `grep -n "^\.tl2-card\|^\.sc18-res\|^\.sc18-args\|^\.error-card" src/components/{chat,console}.css` | `chat.css:343,772,776,872,1198,1061`; `console.css:65,71,77` ✔ |
| `grep -n "composer-card-v13\|composer-dock-v13" src/components/console.css` | `:634-645` ✔ |
| `grep -n "app-rail-bar-v13" src/components/shell.css` | `:132-152` ✔ |
| `grep -n "wt-chip\|wt-menu\|wt-current" src/components/{chat,workspace}.css` | `chat.css:2559-2604`, `workspace.css:671` ✔ |
| `grep -n "^\.pv-title\|^\.pv2-built" src/components/chat-final.css src/components/preview.css` | `chat-final.css:198`, `preview.css:36` ✔ |

**Files created by this subagent:** only `docs/DESIGN-COMPARISON-V1132.md`.
**الملفات التي أنشأها هذا الوكيل الفرعي:** هذا المستند فقط.

---
*End of document / نهاية المستند.*
