# Mention file inside the `+` popover — v11.43 / استشهاد بملف داخل زر الزائد

**Status:** implemented · typecheck green · 4/4 verification suites green (0 dead controls).
**Scope owned:** `src/components/Composer.tsx`, `src/components/AttachMenu.tsx`, `src/components/chat-final.css`, plus this doc and the additive guard `tests/v1143-mention-in-plus.test.mjs`. No edits to `store.ts`, `i18n.ts`, `ChatPanel.tsx`, or other CSS.

---

## العربية — المطلوب والتنفيذ

**شكوى المؤسس:** «كم مرة حكيت لك شايف أوامر السلاش وأوامر هذيك الدائرة اللي بنص إيه تبعت المنشن فايل، إنه أحسن ما تكون جوا الشات بانل وعملات منظر غير مريح… تنقلها داخل الزائد تحت ريوان تو تشيك بوينت وجوا التبويبة تبعت الاتاتش ايمج والقصة هاي.»

**اللي صار:**

1. **شيلنا القائمة العائمة.** ما عاد فيه منيو `@` يطلع فوق نص الشات. في `Composer.tsx` انحذف كامل بلوك `menu === 'mention'` (مكانه الآن تعليق توضيحي بس في `Composer.tsx:1711`). حالة القائمة صارت slash فقط (`Composer.tsx:888`)، وانحذفت المساعدات القديمة `mentionItems` / `applyMention` / `mentionMatch`. كتابة `@` لسه تكتب رمز حرفي للي يحبونها (ما فيها قائمة تطفح فوق المحادثة).
2. **حطينا القائمة داخل الزائد.** في `AttachMenu.tsx` صار فيه صف disclosure جديد «Mention file / استشهاد بملف» (`AttachMenu.tsx:326`–`340`) جنب «Attach image» و«Commands» و«Prompt presets» و«Rewind». لما تفتحه يطلع submenu رفيع فيه **نفس** شجرة الملفات المحدودة (`mentionPaths`) مع فلتر حي (` AttachMenu.tsx:140`–`190`). كل صف ملف/مجلد يستخدم نفس دالة الإدراج الحقيقية `insertMention` / `@path` — ما فيه IPC جديد ولا قناة store جديدة ولا إرسال تلقائي (`Composer.tsx:2046`–`2047`، `AttachMenu.tsx:345`).
3. **ما انكسر شيء قديم.** أوامر السلاش لسه داخل نفس الزائد (`AttachMenu.tsx:81`, `AttachMenu.tsx:297`)، والعناصر الأربعة الأصلية (`role="menuitem"`) ما تغيّرت. سقف `MAX_MENTION_FILES = 200` (`Composer.tsx:49`) و`flattenTree` (`Composer.tsx:874`–`881`) لسه مصدر القائمة الوحيد.
4. **الشكل والسلوك.** خطوط شعرية بس، حواف logical تنعكس في RTL، مسارات اللاتينية مثبتة `dir="ltr"`، تسميات بلغة واحدة لكل رندر (fallback ثنائي اللغة عبر `t(key, L(en, ar))` — ما احتجنا تعديل `i18n.ts`)، تركيز مرئي، حالات تقليل حركة في الاتجاهين (`chat-final.css:1284`–`1302`)، وصفر عناصر ميتة.

**النتيجة:** المنيو ما عاد «بنص الشات» — صار تبويبة داخل زر الزائد، تماماً زي تبويبة الاتاتش ايمج والأوامر.

---

## English — what changed and why

**Founder's repeat complaint:** the `@` file-mention menu floated in the middle of the chat panel; move it into the existing `+` (AttachMenu) popover, next to attach-image and the other items. Slash commands were already moved there in v1142 — verify they stay.

**Implementation:**

1. **Floating menu removed.** The `menu === 'mention'` block was deleted from the composer card (`src/components/Composer.tsx:1711`); only a short explanatory comment remains. The menu union is now slash-only (`Composer.tsx:888`), and the old `mentionItems` / `applyMention` / `mentionMatch` helpers are gone. Typing `@` still writes a literal token for power users, but it no longer pops a list over the chat.
2. **Same list, new home.** `src/components/AttachMenu.tsx:326`–`350` adds one hairline **"Mention file / استشهاد بملف"** disclosure row inside the `+` popover. Expanding it renders `MentionFilesSubmenu` (`AttachMenu.tsx:140`) from the **same** capped `mentionPaths` tree, with a live filter replacing the old `@query` fuzzy match. Rows keep file/folder icons and LTR-pinned relative paths. Picking one calls the composer's real `insertMention(@path)` (`Composer.tsx:977`) and closes the popover — no new IPC, no fabricated store channel, no auto-send.
3. **Nothing else moved.** The v1142 slash group still lives in the same popover (`AttachMenu.tsx:81`, `:297`), and the original four `role="menuitem"` rows are byte-for-byte unchanged. `MAX_MENTION_FILES = 200` (`Composer.tsx:49`) and `flattenTree` (`:874`) remain the single source of the file list.
4. **Design contract.** One hairline border, logical (RTL-mirroring) insets, no card/blur/gradient/keyframes; bilingual single-language-per-render labels with inline fallback (no `i18n.ts` edit); visible focus ring; both reduced-motion gates cover the new controls (`chat-final.css:1284`–`1302`); zero dead controls.

---

## Source map (file:line)

| Concern | Location |
| --- | --- |
| Floating '@' menu deleted (comment marks the spot) | `src/components/Composer.tsx:1711` |
| Slash-only menu state, no `'mention'` menu | `src/components/Composer.tsx:601`, `:888` |
| Capped file tree (`MAX_MENTION_FILES = 200`) | `src/components/Composer.tsx:49`, `:874`–`:881` |
| Real `@path` insert action (reused, no new channel) | `src/components/Composer.tsx:977` |
| Capped list + action handed to the `+` popover | `src/components/Composer.tsx:2046`–`:2047` |
| v1142 slash submenu still in `+` | `src/components/AttachMenu.tsx:81`, `:297` |
| Mention disclosure row + submenu in `+` | `src/components/AttachMenu.tsx:326`–`:350` |
| Real file-list submenu (filter, icons, wired rows) | `src/components/AttachMenu.tsx:140`–`:190` |
| Row pick → `onMentionFile` → close | `src/components/AttachMenu.tsx:345` |
| Structural `MentionFileItem` type (no circular import) | `src/components/AttachMenu.tsx:49` |
| Hairline submenu CSS (12d) | `src/components/chat-final.css:1088`–`:1147` |
| Both reduced-motion gates | `src/components/chat-final.css:1284`–`:1302` |
| Source + SSR guard (12 assertions) | `tests/v1143-mention-in-plus.test.mjs:44`–`:335` |

---

## Verification / التحقق

```
npx tsc --noEmit                                          → pass (0 errors)
node --test --test-force-exit tests/v1137-chat-controls.test.mjs   → 15/15 pass
node --test --test-force-exit tests/v1142-slash-menu.test.mjs      → 12/12 pass
node --test --test-force-exit tests/v1131-full-smoke.test.mjs      → 82/82 pass
   (screens 60/60 · dead controls 0 · unstable selectors 0)
node --test --test-force-exit tests/v1143-mention-in-plus.test.mjs → 12/12 pass
```

The guard checks, with `file:line` on failure:

- **Source:** no floating mention menu in Composer; slash stays in `+`; the capped tree is the only file source; picking calls the real insert, never send/IPC; one disclosure owns a wired file submenu; bilingual/RTL/hairline/reduced-motion; zero dead controls in both edited TSX files.
- **SSR:** the closed `+` popover shows the disclosure but no expanded file list (no duplicate over chat); the expanded submenu renders the real paths with a live filter, one wired row per file/folder, correct EN and AR labels and counts; an empty tree shows an honest empty state instead of a dead control.
