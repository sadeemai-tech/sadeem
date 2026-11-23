# CHAT CONTROLS — v11.37 (Arabic + English)

## 1 · الطلب / The request

> الشباتات بنا شايف الاتاتش ايمج وبرومبت بروستيتس وريوان تو تشيك بوينت، هذول اللي جايات على الشات بانل نفسها… تجمع لي اياهن. اطلع كيف تشيلهن، تحط علامة الزائد، وعلامة الزائد تفتح نافذة هيك صغيرة انه فيها شو اسمه هذول الثلاث، وفيها القدرة كمان. اضف القدرة على اتاتش مستند… وايضا اريدك ان تضيف على الشات نفسها الايفورت… الموديل نفسه، إنه شو عنده مراحل الإفورت ينحط نفسها… والإفورت يفتح لي نافذة صغيرة فيها إشي أسحبه.

Collect the three chat-panel buttons (attach image · prompt presets · rewind to checkpoint) behind **one `+` button**; add **attach document**; add a **real effort slider on the chat** that uses the model's own effort stages and actually changes the agent.

---

## 2 · التصميم المرتكب / The invented design

### 2.1 زر الزائد والقائمة الشعرية / The `+` trigger and hairline popover

- One circular `+` trigger sits in the composer toolbar (`.cf-attach-trigger`).
- It opens a **small hairline popover** (`.cf-attach-pop`) — a single 1px border, hairline row separators, **no boxy card, no shadow, no gradient, no blur**.
- The popover holds exactly **four** rows:
  1. `Attach image` — `.pdf`-free image path (existing vision path).
  2. `Attach document` — **new**.
  3. `Prompt presets` — the former "prompt prosthetics" button.
  4. `Rewind to a checkpoint` — the former rewind button.
- Dismiss on outside-click, Escape, or the hairline `×` in the header. The image row mirrors the real `MAX_IMAGES` cap (`disabled` when full).
- Labels are larger and clear (13.5px), each a single localized `t(key, fallback)` call — no mixed-sigil strings.

`src/components/AttachMenu.tsx:38` (`AttachMenuPanel` — SSR-testable open body), `:123` (`AttachMenu` — trigger + dismissal), `:159` (`data-testid="chat-attach-menu"`).
`src/components/chat-final.css:895` (V1137 section), `:918` (`.cf-attach-pop`).

### 2.2 إرفاق مستند / Attach document

- A second hidden file input (`DOC_ACCEPT`) opens the document picker; it calls the **same** `attachFiles` used by images, paste and panel drops.
- Documents (`.pdf`, `.docx`, `.txt`, `.md`, spreadsheets, presentations, …) take the existing **non-image branch**: they become a real `@<absolute path>` mention on Electron (`f.path`), falling back to `@<file name>` in a browser-only context. This is the honest, already-wired ingestion path — no fabricated store channel, no fake document bytes.

`src/components/Composer.tsx:52` (`DOC_ACCEPT`), `:679` (`mentions.push(\`@${path || f.name}\`)`), `:2046-2050` (document input), `:2063` (menu item → picker).

### 2.3 الإفورت الحقيقي / The real effort control

- A small chip `.cf-effort-trigger` lives on the chat beside the `+`. It shows the **store-backed** current stage.
- It opens a tiny hairline popover with a **draggable two-stop rail** (`.cf-effort-range`, a real `<input type="range" min=0 max=1 step=1>`) plus two labelled stop buttons for precision.
- **The two stops ARE the model's own stages** — `effort?: 'standard' | 'deep'` at `shared/types.ts:1050`. No finer levels were invented.
- It writes through the **real store action** `updateSettings({ agent: { ...agent, effort } })` — identical to `/effort` at `src/store.ts:3763-3766` (action defined at `:2831`). This persists and reaches the engine: `electron/agent/engine.ts:3534` doubles the step budget for `deep`, and `:3014` forwards the same stage to the model. The slider changes real behaviour — it is not a decorative gauge.

`src/components/EffortControl.tsx:25` (`EFFORT_LEVELS`), `:27/:31` (exact mapping helpers), `:40` (`EffortSlider`), `:62-71` (range input), `:89` (`updateSettings` subscription), `:118` (real store write).
`src/components/chat-final.css:1039` (`.cf-effort-pop`), `:1083` (`.cf-effort-rail`, `direction: ltr` so "low → high" never flips in RTL), `:1141/:1150` (both reduced-motion gates).

---

## 3 · القيود / Design law compliance

- Hairlines only (`--line-soft` / `--line-strong`); logical insets (`inset-block-end`, `inset-inline-start`) mirror in RTL; no new keyframes; both `prefers-reduced-motion` and `html.reduce-motion` gates settle the tiny transitions.
- No dead controls: every button/input is wired; the full smoke scanned **704 controls across 60 screens — 0 dead, 0 unstable selectors**.
- D12's enlarged chat font is untouched; the new rows use 13.5px / 12.5px (not shrunk).
- Only the owned files were edited. `store.ts`, `i18n.ts`, `engine.ts`, `prompts.ts`, `types.ts` were **read only**.

---

## 4 · التواريخ المطلوبة / Handoffs to the parent agent

These are NOT fabricated — they are the exact places where a further change would be needed:

1. **i18n keys (new labels).** `src/i18n.ts` cannot be edited by this agent. The new keys currently use localized inline fallbacks via `t(key, fallback)` (so both languages render correctly today), but they should be added to the dictionary for consistency:
   - `chat.attach.menu` → EN "Add to chat" / AR "أضف إلى المحادثة" (near `src/i18n.ts:385`).
   - `chat.attach.document` → EN "Attach document" / AR "إرفاق مستند".
   - `chat.effort` → EN "Effort" / AR "الجهد" (near `src/i18n.ts:1560`, beside `settings.agent.effort`).
   - `chat.effort.standard` / `chat.effort.deep` → "standard"/"قياسي", "deep"/"عميق".
   - `chat.effort.hint` → the two-line hint (near `src/i18n.ts:1561`).

2. **Finer effort levels (optional).** `shared/types.ts:1050` declares only `'standard' | 'deep'`. A third/fourth stage (e.g. `'minimal' | 'medium' | 'max'`) requires widening that union **and** updating `src/store.ts:3765` (the `/effort` toggle) and `electron/agent/engine.ts:3534/:3014`. This agent deliberately did **not** invent extra stages.

3. **True document-content ingestion (optional).** `src/store.ts:1068` defines `sendMessage: (text, images?, displayAs?)` — there is no document-content channel. Today "attach document" uses the existing `@path` mention path (`src/components/Composer.tsx:679`), which is real but only references the file; if the founder wants the document's **text extracted and sent as content**, the parent must add a bridge/store field (e.g. `documents?: { name: string; text: string }[]`) and extend `sendMessage` + the engine's prompt builder. Nothing fake was added here.

4. **Browser-only path caveat.** Non-Electron builds have no absolute `f.path`; the attach path falls back to `@<file name>` (`src/components/Composer.tsx:679`). Document attachments are therefore most meaningful in the Electron app where the workspace path exists.

---

## 5 · التحقق / Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean (0 errors) |
| `node --test tests/v1137-chat-controls.test.mjs` | **15/15 pass** (source + SSR: `+` opens a 4-item popover, document wired, 2-stop slider wired to `updateSettings`) |
| `node --test tests/v1131-full-smoke.test.mjs` | **82/82 pass**, WAVE FAILURES 0; 60 screens RENDERS OK; **0 dead controls / 704 scanned**; 0 unstable selectors |
| `node --test tests/v1134-ui-layout.test.mjs` | **11/11 pass** (D12 font/scope layout still green) |

Files changed (all within ownership): `src/components/Composer.tsx`, `src/components/AttachMenu.tsx` (new), `src/components/EffortControl.tsx` (new), `src/components/chat-final.css`. Test: `tests/v1137-chat-controls.test.mjs`. This document: `docs/CHAT-CONTROLS-V1137.md`.
