# PANELS HEALTH / صحة الأقسام واللوحات — v11.21

> Audit date: 2026-11-19 · Scope: every rail view in `src/components/panels/registry.tsx`,
> every settings group in `src/components/settings/registry.ts` + `SettingsModal.tsx`,
> plus the embedded panels (`SchedulePanel`, `SecurityPanel`, `WikiPanel`).
> Diagnosis-only pass: **no application source was edited** by this audit.

---

## الخلاصة / Executive summary (brutally honest)

| Finding | Verdict |
|---|---|
| React **#300** crash in the Skills panel | **REAL — confirmed at source level.** `SkillsPanel.tsx:434` calls `useCallback(loadRivals)` **after** two conditional early returns (`:377` and `:380`). The hook count changes between renders → React #300 / #310. Owner **B1** (owns Skills); this audit did NOT edit it. |
| Other 14 stage rails + home + editor | **OK** — no hook-after-return, no conditional hook, no unstable object selector, no dead button found. |
| 25 settings groups | **OK** — same clean result. |
| Unstable `useStore((s) => ({...}))` selectors | **NONE** anywhere in panels or settings (0 matches). The requested central guard is in `tests/v1121-panels-smoke.test.mjs` and passes. |
| Dead buttons / missing onClick / non-existent actions | **NONE FOUND** in panels or settings (heuristic + `tsc --noEmit` both clean). |
| `npm run typecheck` | **PASS** (clean). |
| Panel test suites (`v1111-*`, `v1112-*`, `v1116-tools-audit`) | **216 tests: 203 pass, 1 fail, 12 skipped.** The single failure is a **Windows-only perf threshold** in `v1111-antifreeze.test.mjs:330` (`dur < 30_000`, actual 72,906 ms) — NOT a panel, NOT a crash, not related to #300. |
| New smoke test | **RED by design**: `tests/v1121-panels-smoke.test.mjs` test 1 PASSES (no object selectors); test 2 FAILS on `SkillsPanel.tsx:434`. It turns GREEN when B1 moves the hook. |

**Bottom line:** one genuine crash bug (Skills), one stale settings-search entry (accent), one environment-flaky perf test. Everything else renders and is wired.

---

## جدول لوحات المسار / Rail + panel table

Status = **OK** (no issue found) · **SUSPECT** (not a crash, but misleading/dead affordance) · **BROKEN** (confirmed crash).

| # | Rail view | Component / source | Status | Evidence |
|---|---|---|---|---|
| 00 | `home` | `registry.tsx:101` (`() => null`; real surface is `components/Home.tsx`, mounted at `App.tsx:254`) | OK | Renders separately, wrapped in `SurfaceErrorBoundary`. |
| 01 | `workspace` | `WorkspacePanel.tsx` (`registry.tsx:102`) | OK | All hooks top-level; `Btn`/`IconBtn` all wired to store/IPC; no object selector. |
| 02 | `sessions` | `SessionsPanel.tsx` (`registry.tsx:103`) | OK | Embeds `SchedulePanel` at `:754` — also clean. |
| 03 | `git` | `GitPanel.tsx` (`registry.tsx:104`) | OK | `gitStage`/`gitCommit`/`setDiffView` all exist in store. |
| 04 | `mcp` | `MCPPanel.tsx` (`registry.tsx:105`) | OK | Largest panel (2259 lines); AST scan clean; all `mcp*` IPC methods declared. |
| 05 | `usage` | `UsagePanel.tsx` (`registry.tsx:106`) | OK | — |
| 06 | `dna` | `DnaPanel.tsx` (`registry.tsx:107`) | OK | `:270` "no-op" comment is only a legacy-preload catch fallback, not a dead control. |
| 07 | `flows` | `FlowsPanel.tsx` (`registry.tsx:108`) | OK | IPC absence degrades gracefully (`bridge` guards). |
| 08 | `skills` | `SkillsPanel.tsx` (`registry.tsx:109`) | **BROKEN** | **React #300**: `useCallback(loadRivals)` at **`SkillsPanel.tsx:434`** is after `if (openSlug) return ...` at **`:377`** and `if (creating) return ...` at **`:380`**. Opening a skill → detail view then going Back changes the hook count → crash. Also triggers #310 on the way in. Confirmed by AST scan + `tests/v1121-panels-smoke.test.mjs` test 2. |
| 09 | `artifacts` | `ArtifactsPanel.tsx` (`registry.tsx:110`) | OK | — |
| 10 | `library` | `LibraryPanel.tsx` (`registry.tsx:111`) | OK | Embeds `WikiPanel` at `:268`. |
| 11 | `wiki` | `LibraryPanel initialTab="wiki"` (`registry.tsx:114-117`); `WikiPanel.tsx` embedded | OK | Same clean component as Library. |
| 13 | `prompts` | `PromptsPanel.tsx` (`registry.tsx:112`) | OK | — |
| 14 | `search` | `components/SearchPanel.tsx` (`registry.tsx:118`) | OK | — |
| 15 | `subagents` | `SubagentsPanel.tsx` (`registry.tsx:119`) | OK | — |
| — | `editor` | `registry.tsx:121` (`() => null`; real surface `EditorArea.tsx`, `App.tsx:266`) | OK | `typecheck` clean; `goWorkspace` at `EditorArea.tsx:262` uses real `setRail`/`toggleSidebar`. |
| — | Scheduled tab (embedded) | `SchedulePanel.tsx` (mounted `SessionsPanel.tsx:19,754`) | OK | All cron actions exist in store (`scheduleAdd/Remove/Toggle/RunJobNow`). |
| — | Security viewer (embedded) | `SecurityPanel.tsx` (mounted `PrivacySection.tsx:166`) | OK | — |

Every stage rail is actually rendered: `App.tsx:238` → `STAGE_RAILS` → `App.tsx:261-263` → `RightDock.tsx:26,55` → `PANELS[rail]`. No rail silently falls through to an empty component.

---

## جدول أقسام الإعدادات / Settings sections table

All 25 groups are reachable from `SettingsModal.tsx:729-782`; `SECTION_TO_GROUP` (`SettingsModal.tsx:256-277`) maps legacy ids (`billing → account`) correctly, so no search hit lands on a blank pane.

| Group | Component | Status | Evidence |
|---|---|---|---|
| general | `GeneralSection.tsx` | OK | — |
| appearance | `AppearanceSection.tsx` | **SUSPECT** | Registry entry `appearance.accent` (`registry.ts:70`, "Accent tint") has **no control**: picker removed by palette law at `AppearanceSection.tsx:48-50,318-319`; stored value is a documented no-op. Searching "accent" jumps to a section without the promised setting. Not a crash. |
| notifications | `NotificationsSection.tsx` | OK | — |
| voice | `VoiceSection.tsx` | OK | — |
| agent | `AgentSection.tsx` | OK | — |
| privacy | `PrivacySection.tsx` (+ embedded `SecurityPanel`) | OK | — |
| memory | `SkillsMemorySection.tsx` | OK | — |
| models | `ModelsSection.tsx` | OK | — |
| providers | `ModelsSection.tsx providersOnly` | OK | — |
| mcp | `McpSection.tsx` | OK | — |
| plugins | `PluginsSection.tsx` | OK | — |
| apiServer | `ApiServerSection.tsx` | OK | — |
| remote | `RemoteSection.tsx` | OK | — |
| preview | `PreviewSection.tsx` | OK | — |
| editor | `EditorSection.tsx` | OK | — |
| terminal | `TerminalSection.tsx` | OK | — |
| git | `GitWorktreeSection.tsx` | OK | — |
| account (billing alias) | `BillingSection.tsx` | OK | `billing: 'account'` at `SettingsModal.tsx:277`. |
| shortcuts | `ShortcutsSection.tsx` | OK | — |
| evidence | `EvidenceSection.tsx` | OK | — |
| logs | `LogsSection.tsx` | OK | — |
| updates | `UpdatesSection.tsx` | OK | — |
| feedback | `FeedbackSection.tsx` | OK | — |
| advanced | `AdvancedSection.tsx` | OK | — |
| approvals | `ApprovalsSection.tsx` | OK | — |

---

## قائمة الإصلاحات المرتّبة / Ranked fix list

### P0 — must fix before release

1. **SkillsPanel React #300** — `src/components/panels/SkillsPanel.tsx:434`.
   Move `const loadRivals = useCallback(...)` (and **any** future hook) **above** the early returns at `:377` (`if (openSlug)`) and `:380` (`if (creating)`). All hooks must execute on every render in the same order.
   - Repro: open Skills → click any skill row → press Back (or New skill → Back). Going back renders more hooks than the previous render → `Rendered more hooks than during the previous render` (#300); the forward navigation renders fewer → #310.
   - Owner: **B1** (owns Skills). This audit did not touch the file.
   - Verify: `node --test --test-force-exit tests/v1121-panels-smoke.test.mjs` → both tests must pass.

### P1 — next

2. **Remove or implement the stale `appearance.accent` search entry** — `src/components/settings/registry.ts:70` vs `AppearanceSection.tsx:48-50,318-319`. Either drop the entry from `SETTINGS_REGISTRY` or render a disabled "fixed by palette law" row so the search hit isn't dead. (UX/dead-affordance, not a crash.)

3. **Keep the central guard green** — `tests/v1121-panels-smoke.test.mjs` is intentionally RED on the P0 bug. It must be part of `npm test` and stay green after the fix. It covers both #300 classes: unstable object selectors and hooks-after-early-return across all panel/settings `.tsx` files.

### P2 — informational, no action required

4. `v1111-antifreeze.test.mjs:330` perf threshold (`dur < 30_000`) fails on this Windows host (72,906 ms for 20k deltas). Other timing tests in that file are already skipped for the same "POSIX-calibrated / Windows timer granularity" reason (`:` skip notes). Either skip this one on Windows too or widen the threshold — but do not mask a real regression.
5. `docs/DIAG-LOGS.md:86,96` records 3 historical React #300/#185 renderer faults in `main.log` without source maps. This audit supplies a concrete source-level #300 cause for the first time; re-check logs after the P0 fix.

---

## المنهجية / Method

- Enumerated all `RailView` panels from `registry.tsx` and all `SettingsNavId` groups from `registry.ts`/`SettingsModal.tsx`; verified each has a real component and an actual render path (`App.tsx` → `RightDock.tsx:55`; `SettingsModal.tsx:729+`).
- **TypeScript AST** scan (not text grep) over every panel/settings `.tsx`: for each function component, tracked top-level `if (...) { return ...; }` guards and any `useState/useEffect/useCallback/useMemo/useRef/...` call appearing after them in the same function → exactly 1 hit (`SkillsPanel.tsx:434`). A second AST pass found no hook nested inside any conditional/loop/switch.
- Selector scan for `useStore((s) => ({...}))` (all spacing variants) → 0 hits.
- All `useStore((s) => s.X)` selector targets verified against the `store.ts` interface → all exist.
- All `api.<method>()` references in panels verified against `src/lib/api.ts` → all declared.
- Button scan (`<button>`, `<Btn>`, `<IconBtn>`) for missing/empty/TODO `onClick` → none; `disabled={true}` → none.
- `npm run typecheck` → clean (no undefined identifiers, no wrong action signatures).
- Test suites run: `node --test --test-force-exit --test-concurrency=4` over all `v1111-*`, `v1112-*`, `v1116-tools-audit` files → 216 tests, 203 pass, 1 fail (environment perf flake above), 12 skipped.
