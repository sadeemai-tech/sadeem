# SKILLS v11.36 — "More actions" + skills actually used
## الحكم الصريح / Blunt verdict

**EN:** Fixed what I owned. The per-skill **More actions** control is no longer a dead no-op: it opens a real menu with **Inspect / Edit / Duplicate / Delete** (built-ins: **Inspect / Copy to edit**) and every item calls the real skill store. The **SKILLS-FIRST** directive now explicitly tells the model that skills **given by the user** must be loaded with `use_skill` **before** planning/answering/editing/improvising. All byte caps are unchanged (EN base prompt still **24425 B**). Skill-body injection on `use_skill` was traced and is intact (read-only; no engine/tools edit).

**AR:** أصلحتُ ما يقع ضمن ملكيتي. زر **«مزيد من الإجراءات»** لكل مهارة لم يعد عنصرًا ميتًا: يفتح قائمة حقيقية (**فحص / تحرير / نسخ / حذف**، وللمهارات المدمجة **فحص / نسخ للتحرير**) وكل عنصر ينفّذ إجراءً حقيقيًا على مخزن المهارات. توجيه **SKILLS-FIRST** صار يقول صراحة إن المهارات **التي يعطيها المستخدم** يجب تحميلها بـ `use_skill` **قبل** التخطيط أو الإجابة أو التعديل أو الارتجال. حدود البايت لم تتغير (البرومبت الأساسي EN لا يزال **24425 بايت**). حقن محتوى المهارة عند `use_skill` تم تتبّعه وهو سليم (قراءة فقط؛ بلا تعديل على engine/tools).

**Not fully solved by me (handoffs below):** the *chat toolbar* **More actions → Skills** item (a different control, in `ChatPanel.tsx`) still toggles a thin inline strip instead of opening the Skills library panel. I do not own that file. `i18n.ts` also needs the new Arabic strings. (A transient `UsagePanel.tsx` type break from another agent's in-flight edit was resolved during verification; both typechecks are now green.)

---

## Exactly what changed / ما تغيّر بالضبط

| # | File:line | Change |
|---|-----------|--------|
| 1 | `src/components/panels/SkillsPanel.tsx:273-357` | New exported `SkillActionsMenu` — real kebab control (`aria-label="More actions"`, `data-testid="skill-more-actions"`) with an open state; `open &&` renders a `role="menu"` with wired `role="menuitem"` buttons. No no-op onClick. |
| 2 | `src/components/panels/SkillsPanel.tsx:298-305` | Menu items: Inspect → detail, Edit → editable detail, Duplicate → read+save copy, Delete → real delete. Built-ins get Inspect + honest fork (no dead Delete/Edit). |
| 3 | `src/components/panels/SkillsPanel.tsx:312-321` | Button `onClick` toggles real state (`setOpen(v => !v)`); every item calls a real handler. |
| 4 | `src/components/panels/SkillsPanel.tsx:630-662` | Real handlers on the real store: `api.skillsRead` (duplicate), `api.skillsSave` (duplicate + edit), `api.skillsDelete`, `api.skillsForkBuiltin`. |
| 5 | `src/components/panels/SkillsPanel.tsx:27,109-152,566` | `SkillDetail` gained `editable` — Edit opens a real name/description/body editor that saves via `api.skillsSave`. |
| 6 | `src/components/panels/SkillsPanel.tsx:820` | Each skill row now uses the menu instead of the old fork/delete-only buttons. |
| 7 | `electron/agent/prompts.ts:1010` | SKILLS-FIRST rewritten: names `use_skill`, the exact phrase **"skills given by the user"**, `MUST call use_skill`, and keeps the contract substring **`use_skill BEFORE`** required by `v1131-full-smoke`. |
| 8 | `src/components/settings/SkillsMemorySection.tsx:165-167` | Note now says given skills are loaded with `use_skill` BEFORE work and are followed, not ignored. |
| 9 | `electron/services/promptLibraryService.ts:198-243` | New `duplicatePrompt(id)` — real new row (fresh id, `(copy)`/`(2)` collision suffix, same text, 200-item cap). Additive only. |
| 10 | `tests/v1136-skills.test.mjs:1-260` | 7 tests: directive wording, byte caps, capability trace, SSR menu, no-dead-control source check, panel SSR, duplicatePrompt. |

## Byte measurement / قياس البايتات (before → after)

- `buildSystemPrompt({...BASE})` (no skills): **24425 B before → 24425 B after** (stable prefix **24292 B** unchanged).
- Reason: the SKILLS block is rendered only when `opts.skills` is non-empty (dynamic tail, `prompts.ts:1006-1014`). The cap suites call it with no skills, so **no byte moved**.
- With a skill present, the strengthened directive reaches the real prompt (covered by `v1136-skills.test.mjs` test 1).

## Verification / التحقق (all run)

- `npx tsc --noEmit` → **green** (`TSC_WEB_GREEN`).
- `npx tsc -p tsconfig.node.json --noEmit` → **green**.
- `node --test tests/v1136-skills.test.mjs` → **7/7 pass**.
- `node --test tests/v1116-prompt-cache.test.mjs` → **11/11 pass**.
- `node --test tests/v1135-token-savings.test.mjs` → **7/7 pass**, `EN=24425B`.
- `node --test tests/v1131-full-smoke.test.mjs` → **82/82 pass**, `V1131_FINAL_FAILURES=0`, 60/60 screens render, 0 dead controls.
- `npx tsc --noEmit` initially failed only in `src/components/panels/UsagePanel.tsx:198,204,342` (another agent's in-flight edit); re-run at the end → **green**. No file outside my ownership was edited by me.

## Read-only capability trace (no edits made) / تتبّع القدرة

The injection already works end to end — I only proved it, did not touch it:

- `electron/agent/tools.ts:1721-1722` — dispatch `case 'use_skill': return await useSkill(args, ctx)`.
- `electron/agent/tools.ts:3250-3284` — `useSkill()` loads the real `SKILL.md` (`loadSkill` at :3253), wraps the body as advisory (:3276), and returns it in the tool output (:3277-3283).
- `electron/agent/engine.ts:2042,6146-6150` — engine tracks `skillsUsedThisRun` and observes the `use_skill` call.
- `tests/v1131-skills.test.mjs:197-209` and `tests/v1126-skills-use.test.mjs:199-210` already prove the real body reaches a **later provider request** as context, plus ledger + evidence gate.

**Verdict:** capability #3 needs no code change. Another agent owns `tools.ts`/`engine.ts`; do not "fix" what is already proven working.

---

## Handoffs / تسليمات (to parent)

### 1. The literal founder complaint: chat **More actions → Skills** (not my file)
- `src/components/ChatPanel.tsx:1637-1639` — menu item `label: t('chat.skills','Skills')`, `run: () => setSkillsOpen(!skillsOpen)`.
- `src/components/ChatPanel.tsx:948-995` — `SkillsStrip` renders only that thin inline strip, and reads store `skills` (often empty) → **"clicking shows nothing"**.
- `src/components/ChatPanel.tsx:1018` — `setRail` is already imported in that scope.
- **Suggested fix:** change `run` to `() => setRail('skills')` so the item opens the full Skills library panel (`SkillsPanel.tsx`) the founder means. This is a one-line change in a file I was forbidden to edit.

### 2. i18n keys (I could not edit `src/i18n.ts`)
Add these (English fallback is already inline in the components; Arabic is missing):
```
'skills.more': ['More actions', 'مزيد من الإجراءات'],
'skills.action.inspect': ['Inspect skill', 'فحص المهارة'],
'skills.action.edit': ['Edit skill', 'تحرير المهارة'],
'skills.action.duplicate': ['Duplicate skill', 'نسخ المهارة'],
'skills.duplicated': ['Skill duplicated', 'تم نسخ المهارة'],
'skills.duplicateFailed': ['Could not read this skill to duplicate it.', 'تعذّرت قراءة المهارة لنسخها.'],
```
Also **update** `src/i18n.ts:2018-2021` (`sm.skills.note`) to the new English text from `SkillsMemorySection.tsx:166` — because the key exists, the UI currently still shows the old string (my inline fallback is shadowed).

### 3. `tsc --noEmit` (resolved — watch for regression)
`src/components/panels/UsagePanel.tsx:198,204,342` briefly broke typecheck from another agent's concurrent edit; it was fixed before final verification. If it reappears, it belongs to that file's owner, not to this skills work. Both typechecks are green now.

### 4. No engine/tools change needed
See trace above. `use_skill` body injection is proven working; only the *prompt instruction* needed strengthening (done at `prompts.ts:1010`).
