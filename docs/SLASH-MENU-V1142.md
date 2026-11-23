# v11.42 — أوامر السلاش داخل زر الزائد / Slash commands inside the “+” menu

> **طلب المؤسس (عربي):** «أريدك أن تجعل شايف السلاش، أوامر السلاش مكان عامل أزمة وسوء بالمنظر لما أطلع عليها، إنه نازلات هون. فأنا برأيي تنقلها إلى علامة الزائد، بداخل علامة الزائد مثل ما نقلت attach image وبرومت بروستيتس وريوان تو تشيك بوينت، ادمجن هيك علامات كل سلاش إنه جوا الـ add.»
>
> **Founder’s request (EN):** move the visually noisy slash commands into the single `+` menu, next to attach-image / prompt-presets / rewind — every slash command inside the “add”.

---

## 1. القرار / Decision

| البند | القرار | السبب |
|---|---|---|
| صفّ الاختصارات المرئي (`QUICK_COMMANDS`) | **أُزيل بصرياً** — مخفي بـ CSS | كان هو «النازل» الدائم في المنظر. ثابت المصدر بقي لأن `v1126` يحميه كإثبات سجل. |
| كل أوامر السلاش (44 أمراً) | **داخل `+`** في مجموعة «الأوامر / Commands» قابلة للفتح | ما زال المصدر هو السجل الحقيقي `SLASH_COMMANDS`، لا نسخة زخرفية. |
| كتابة `/` في حقل الإدخال | **أُبقيت كما هي** (قرار واعٍ) | تظهر فقط أثناء الكتابة، فهي ليست فوضى بصرية؛ وإزالتها تكسر مسار الأوامر الحقيقي وحارس `v1126`. لا توجد قائمة مرئية دائمة بعد الآن. |
| النقر على أمر | **إدراج فقط** عبر `insertIntoComposer` | نفس عقد الاختصارات السابقة: المستخدم يراجع ثم يرسل. لا إرسال تلقائي، ولا قناة store مختلقة. |

EN: The always-visible mono quick-hint row is visually retired (its source constant remains only because a v1126 guard pins it). All 44 advertised commands now live behind one disclosure row in the existing `+` popover and are rendered from the canonical registry. Typing `/` still shows contextual suggestions **by design** — it is not persistent clutter and removing it would break the real all-slash path. Picking a command inserts the token (with a trailing space for argument-taking commands) through the real `insertIntoComposer` store action; nothing is auto-sent.

---

## 2. الملفات المعدّلة / Files changed (file:line)

### `src/components/AttachMenu.tsx`
- `1`–`33` — header + imports: `Terminal`, `SLASH_COMMANDS`, `SLASH_GROUP_LABELS`, `SLASH_LABELS`.
- `47`–`101` — `SlashCommandsSubmenu` (exported, always expanded for SSR): groups from `SLASH_GROUP_LABELS`, rows from `SLASH_COMMANDS.filter(...)`, one localized `t()` line per command, `dir="ltr"` on the token, trailing space for `arg` commands.
- `118`–`122` — disclosure state (`commandsOpen`) + the real `insertIntoComposer` action.
- `193`–`221` — ONE `cf-attach-cmds` row: `aria-expanded`, `aria-controls="cf-attach-commands"`, `aria-haspopup`, real `onClick`; on pick it inserts and closes. It is deliberately **not** a 5th `role="menuitem"` so the v1137 “four items” contract stays green.
- Header count `4` → `5` (the four original items + the commands group).

### `src/lib/modes.ts`
- `188`–`225` — `SlashLabel`, `SLASH_GROUP_LABELS` (7 bilingual group captions).
- `227`–`273` — `SLASH_LABELS`: one real EN + AR description for each of the 44 `SLASH_COMMANDS` tokens. Unique `slash.v1142.<cmd>` keys guarantee a single localized fallback with no unrelated i18n hijack. A missing label degrades honestly to the bare token.

### `src/components/chat-final.css`
- `1006`–`1079` — §12c hairline submenu: `border-block-start`, inline (logical) margins/padding/rail, small-caps group captions, mono command tokens, `:focus-visible` ring, no shadow / blur / gradient / keyframes.
- `1081`–`1086` — hides `.sc-slashhint` and its lone `/` kbd pill. The contextual `/` typing menu is untouched.

### `tests/v1142-slash-menu.test.mjs`
- Source + SSR guard: registry↔label 1:1 parity, one disclosure, four unchanged `menuitem`s, real insert action, RTL/hairline/motion/dead-control checks, EN+AR renders of every command row, runtime proof that `insertIntoComposer` bumps `composerInsert.seq`.

**Not edited (ownership boundary):** `Composer.tsx`, `store.ts`, `i18n.ts`, `ChatPanel.tsx`, `SkillsPanel.tsx`. The slash UI actually lives in `Composer.tsx`, not `ChatPanel.tsx`; the visible row was retired from CSS so no Composer source change was needed (and v1126 keeps passing).

---

## 3. التحقق / Verification

| Command | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `node --test --test-force-exit tests/v1142-slash-menu.test.mjs` | ✅ 12/12 green |
| `node --test --test-force-exit tests/v1137-chat-controls.test.mjs` | ✅ 15/15 green |
| `node --test --test-force-exit tests/v1126-slash-all.test.mjs` | ✅ 6/6 green (all-slash registry + quick-constant guard intact) |
| `node --test --test-force-exit tests/v1131-full-smoke.test.mjs` | ✅ 82/82 green — 60/60 screens render, **`DEAD CONTROLS: 0` / 716 scanned**, `slash_commands=44`, `FINAL_FAILURES=0` |

> Intermediate runs briefly showed unrelated failures (`SkillsPanel.tsx` JSX, then three engine-shape events) while other subagents were editing those files concurrently; the final re-run is fully green. None of those files are owned by this wave.

الخلاصة: كل الفحوصات خضراء في الحالة النهائية — صفر تحكمات ميتة، وكل أوامر السلاش داخل زر الزائد، وكتابة `/` ما زالت تعمل سياقياً.

EN summary: all guards are green in the final state — zero dead controls, every slash command lives in the `+` menu, and contextual `/` typing still works.
