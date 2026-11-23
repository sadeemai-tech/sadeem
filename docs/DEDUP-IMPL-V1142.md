# DEDUP IMPLEMENTATION V1142 — what Z6 actually changed
# تنفيذ التنظيف V1142 — ما الذي غيّره Z6 فعليًا

> **Scope:** 4 source/test files + this document. No engine, no IPC, no shared types touched.
> decision context: `docs/DEDUP-V1142.md`. Date: 2026-11-22.

---

## 0. Summary / الخلاصة

| # | Change | File:line | Status |
|---|---|---|---|
| 1 | Removed the duplicate **Wiki rail** from the More flyout | `src/components/Rail.tsx:71-73,92-103` (wiki item + `IcWiki` + `BookOpen` import gone) | DONE |
| 2 | Removed Wiki from the visible **stage-rail set** | `src/components/panels/registry.tsx:98-116` (`wiki` gone from `STAGE_RAILS`) | DONE |
| 3 | Kept an **invisible compat alias** `PANELS.wiki` (deliberate, see §2) | `src/components/panels/registry.tsx:131-139` | DONE (deviation documented) |
| 4 | Removed the now-unused `WikiPanel` import from the registry | `src/components/panels/registry.tsx:8-20` | DONE |
| 5 | **Merged all skill-add entry points into ONE** "Add skill" button + menu | `src/components/panels/SkillsPanel.tsx:493-496,794-821` | DONE |
| 6 | Catalog load moved from the old Marketplace footer button into an effect | `src/components/panels/SkillsPanel.tsx:539-554` | DONE |
| 7 | Marketplace / rival-import footers are now **details**, not entry points | `src/components/panels/SkillsPanel.tsx:922-972,974-1036` | DONE |
| 8 | Updated the obsolete guard that forced Wiki to be a first-class rail item | `tests/v1131-ui-shell.test.mjs:228-232` | DONE |
| 9 | **Agent-count setting in `shared/types.ts`** | — | **NOT DONE — collision risk with Z12 (owns `types.ts`). Reported to parent.** |
| 10 | Visible Wiki link inside `LibraryPanel` | `src/components/panels/LibraryPanel.tsx:411-421` | **Already existed** — verified, no edit needed |

---

## 1. Wiki rail removal — verification first / التحقق قبل التنفيذ

**Verified before touching anything:** `PANELS.wiki` was literally
`LibraryPanel` with `initialTab="wiki"` (`registry.tsx:130-134`), and `LibraryPanel` already
renders a visible two-tab strip ("Files" / "Repo Wiki") at `LibraryPanel.tsx:411-421`,
switching via `setTab('wiki')` and rendering `<WikiPanel embedded />` at `:423-424`.
So the rail was a **pure duplicate surface** and Wiki was already reachable from Library.

**Edits:**
- `Rail.tsx` — deleted the `view: 'wiki'` item from `MORE` (old `:102`), deleted `IcWiki`
  (old `:71-75`) and its `BookOpen` import (old `:14`). New comment at `:71-73`.
- `registry.tsx` — removed `'wiki'` from `STAGE_RAILS`; removed the dead `import * as WikiMod`.

### §2 Deliberate deviation from the literal instruction
The brief said to remove `registry.tsx:130-134` too. **I kept it as an explicitly-labelled
compat alias** (`registry.tsx:131-139`) instead, for three concrete reasons:

1. `RailView` still contains `'wiki'` (`src/store.ts:58` — a shared file, not in my ownership).
   `RAIL_NO`, `RAIL_TITLE` and `PANELS` are `Record<AllRail, …>`; deleting only the PANELS key
   is a TypeScript error. A full removal requires editing `store.ts`, `Sidebar.tsx:34`
   (`DEFAULT_W.wiki`) and both other Records — a wider blast radius than the cleanup warrants.
2. `RightDock.tsx:38`, `StagePage.tsx:18` and `Sidebar.tsx:119` index `RAIL_TITLE[rail].key`
   **without a fallback**. A stale/deep-linked `rail='wiki'` would crash the shell.
3. The alias is **invisible**: it is no longer in the rail, no longer in `STAGE_RAILS`, and
   nothing in `src/` sets `rail='wiki'` any more (repo-wide search). It only guarantees that an
   old link still lands on the Library's Wiki tab.

If the parent wants the alias gone too, it must be done as one atomic change across
`store.ts:58`, `Sidebar.tsx:34`, and all four `Record<AllRail,…>` maps in `registry.tsx`.

### Test contract updated
`tests/v1131-ui-shell.test.mjs:228` previously asserted
`/view: 'wiki', icon: IcWiki/` ("repo wiki is a first-class More entry") — the exact obsolete
contract this task reverses. It now asserts the opposite plus the Library-tab reachability
(`:228-232`). No other test referenced the wiki rail item.

> Gotcha handled: my first comment inside `STAGE_RAILS` used single-quoted `'wiki'`; the guard's
> regex `/'([a-z]+)'/g` parsed it as a stage view. Rewording the comment (`:109-111`) fixed it.

---

## 3. Skills — three entry points → one / المهارات — ثلاثة مداخل إلى واحد

**Before:** two competing toolbar icons (`New skill`, `Import skill folder`) **plus** two
always-visible footer sections with their own toggle buttons (`Marketplace`,
`Import from other agents`) — i.e. four visible "add" affordances for three import systems.

**After:** one primary **"Add skill"** button (`SkillsPanel.tsx:794-803`) opens one menu
(`:806-821`) with four real actions:

| Menu action | Handler (unchanged, still real) |
|---|---|
| New skill | `setCreating(true)` → `NewSkillForm` |
| Import skill folder | `importFolder()` at `:615-631` — `api.openFolderDialog()` + `api.skillsImportDir()` |
| Marketplace | `setMarketOpen` → catalog via `api.skillsMarketplaceList()` (effect at `:539-554`) |
| Import from other agents | `toggleRivals()` at `:694-698` → `loadRivals()` + `api.rivalsSkillsImport()` |

- The Marketplace (`:922-972`) and rival-import (`:974-1036`) blocks now render **only when
  opened from that menu**; their old footer toggle buttons are gone. No functionality was
  removed — install/remove/scope-select/import all still call the same real IPC.
- Catalog loading moved into a guarded effect so a failed fetch still reports
  `t('skills.market.loadFailed', …)` instead of pretending "no skills" (`:539-554`).
- The empty-state "New skill" button (`:808` area) remains — it is contextual (only when no
  skills match), not a competing header entry.
- No dead controls: the full-smoke `CONTROLS: no dead controls on any smoke-tested screen`
  guard passes with the new buttons (`--test-name-pattern="SSR:|CONTROLS|COVERAGE|DETECTORS"` → 64/64).
- All source-string contracts in `tests/v1131-ui-ext.test.mjs:204-229` were preserved verbatim
  (`openFolderDialog`, `skills.importFailed`, `skills.market.loadFailed`,
  `") : marketError ? ("`, `setMarketError(null);`, install/remove output strings).

---

## 4. Things I did NOT change (collision / honesty) / ما لم أغيّره

1. **`shared/types.ts` — agent-count setting: NOT added.** Z12 owns that file. No `maxSubagents`
   field exists yet (`AppSettings.agent` at `shared/types.ts:1055-1088`), and the only cap is
   `engine.ts:987` (`BACKGROUND_SUBAGENT_CAP = 64`, background path only). Wire-up plan is in
   `docs/DEDUP-V1142.md` §6. **Parent: assign this to Z12.**
2. **`LibraryPanel.tsx` — no edit.** Its Wiki tab already satisfies "visible link".
3. **`src/components/settings/PluginsSection.tsx` — skipped** as instructed.
4. No i18n dictionary edit: new labels use the repo's existing bilingual fallback convention
   (`t('skills.add', 'Add skill · إضافة مهارة')`), so AR UI is not left with English text.

---

## 5. Verification / التحقق

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** (`TSC_EXIT=0`). `npx tsc -p tsconfig.node.json --noEmit` also clean |
| `node --test tests/v1131-ui-shell.test.mjs tests/v1131-ui-ext.test.mjs` | **35/35 PASS** |
| `node --test --test-name-pattern="SSR:\|CONTROLS\|COVERAGE\|DETECTORS" tests/v1131-full-smoke.test.mjs` | **64/64 PASS** (all SSR screens incl. SkillsPanel, Wiki-via-Library, dead-control scanner, registry coverage) |
| Full `tests/v1131-full-smoke.test.mjs` | **78/82** — 4 failures are **engine terminal-report shape** tests (#77–79 + ledger #82), `crashes.log:1-6` points to `electron/agent/register.ts` / `electron/agent/engine.ts` with `requests=0`. Out of this wave's scope. |
| Cross-check `tests/v1128-full-smoke.test.mjs` | **81/81 PASS** |
| Concurrency note | `engine.ts` LastWriteTime **18:41**, i.e. *after* my edits (18:33–18:39) — another wave is editing engine code concurrently. The 4 engine failures are almost certainly that in-flight work, not this UI change. Parent should re-run after Z-engine settles. |

**Bottom line:** every smoke check covering the files I touched is green; `tsc` is clean. The
only red lines are in engine files owned by another active wave.
