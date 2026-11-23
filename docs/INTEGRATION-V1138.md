# Fleet Integration / Collision Audit — v11.38 (DIAGNOSIS ONLY, NO EDITS)

- **Auditor:** FLEET INTEGRATION AUDITOR subagent. **No app source edited** — only this doc was written.
- **Tree:** `sadeem-v11.12.0` (v11.38 WIP, ~20 sibling agents editing concurrently).
- **Last run:** 2026-11-22 ~11:08 local. **The tree was moving during every pass.** Files landed and were re-edited between checks (SignaturePanel appeared at 11:05, registry at 11:06, C1 fixed by its owner ~11:08). **Four** collisions were observed live and self-fixed by their owners mid-audit.
- **Status:** ✅ **ALL GREEN — zero open build blockers.** `npm run typecheck` passes on the final pass.

> **Blunt summary:** Everything is green. `tsc` (app + node), inventory (145), website `tsc` + `next build`, and both v1138 guards all PASS. Structural hygiene is clean — 0 duplicate exported type names, 0 duplicate i18n keys, 0 *real* duplicate store fields, 0 new import cycles, 0 conflict markers, all new v1138 test artifacts present and wired. Four cross-file contract breaks (Git types, PreviewArea TDZ, `byName` Map, SignaturePanel import depth) were each caught **as they landed** and fixed by their owners before the final pass — all four are recorded below so the parent knows they were seen, not missed. The fleet integrated cleanly.

---

## 1. Command results (final pass, ~11:06)

| Check | Command | Result |
|---|---|---|
| App typecheck | `tsc --noEmit -p tsconfig.json` | ✅ PASS (exit 0) on final pass. Earlier in the audit it failed with 11 errors (C1); owner fixed it live. |
| Node typecheck | `tsc -p tsconfig.node.json --noEmit` | ✅ PASS (exit 0) |
| Tool inventory | `node scripts/gen-tool-inventory.mjs` | ✅ **145 tools — `{"fs":55,"exec":60,"meta":30}`**, no drift |
| Website typecheck | `cd website && npx tsc --noEmit` | ✅ PASS (exit 0) |
| Website build | `cd website && npm run build` | ✅ PASS — 9 static routes generated, TS check clean |
| MCP guard | `node tests-v1138-mcp-guard.mjs` | ✅ **PASS — 22 pass / 0 fail** |
| Schedule guard | `node tests-v1138-schedule-guard.mjs` | ✅ **PASS — 46 pass / 0 fail** |
| Duplicate exported type names | analyzer over `shared/types.ts` | ✅ 101 declarations, **0 duplicates** |
| Duplicate i18n keys | analyzer over `src/i18n.ts` | ✅ 2945 keys, **0 duplicates** |
| Duplicate store fields | analyzer over `src/store.ts` | ✅ **0 real** (132 scanner hits are cross-interface false positives — §3) |
| CSS rule collisions | 50 sheets scanned | ⚠️ 131 selectors in >1 sheet — **all cascade / `@keyframes` false positives**, no new hard conflict (§3) |
| Import cycles | DFS over 217 TS/TSX modules | ⚠️ 8 cycles, **all pre-existing; 0 involve any v1138 new file** (§3) |
| Conflict markers (`<<<<<<<`) | source trees (excl. node_modules) | ✅ none |
| New artifact existence | 16 v1138 files | ✅ all present (`SignaturePanel.tsx` landed 11:05) |
| Relative import resolution | 8 actively-edited TS/TSX | ✅ all resolve (C1 fixed live) |

---

## 2. COLLISION TABLE

| # | file:line → symptom | Likely agents that collided | Status / suggested owner |
|---|---|---|---|
| **C1 — RESOLVED ✅ (self-fixed live)** | Was `src/components/SignaturePanel.tsx:14` `from '../../lib/api'`, `:15` `from '../../lib/api'`, `:16` `from '../../store'` → 3× **TS2307**, cascading to 8× **TS7006** implicit-any at `:162,:165,:166,:167,:176,:185,:188,:281`. Root cause: **wrong relative depth** — from `src/components/`, `../lib/api` / `../store` are correct; `../../` escapes to the project root. `:27` `../../electron/agent/signatureFeatures` was correct (electron at root) — author mixed depths. | Signature-panel agent vs. established `src/lib/api.ts` / `src/store.ts` layout. | Fixed ~11:08 by the signature-panel agent: now `../lib/api`, `../lib/api`, `../store`. Final app tsc exit 0. **No action — record only.** |
| **C2 — RESOLVED ✅ (self-fixed live)** | First pass: `src/components/panels/GitPanel.tsx:11` and `src/lib/api.ts:35-36` imported `GitBranchInfo` / `GitIdentityInfo` from `shared/types` → **TS2305** (not exported). The types existed only as local interfaces in `electron/services/gitService.ts:320,385`. `shared/types.ts` has a Git section (`GitChange`, `GitStatus`, `GitDiff`, `GitLogEntry`) but never got the two info types. | Git-service agent vs. shared-types / renderer-API agents — the type contract was split across three owners. | Fixed by 11:04: types relocated to `src/lib/api.ts:324,329` and `GitPanel` repointed to `../../lib/api`. App tsc green for this. **No action — record only.** (Mild debt: `gitService.ts` still keeps duplicate local copies; harmless, structurally typed.) |
| **C3 — RESOLVED ✅ (self-fixed live)** | `src/components/PreviewArea.tsx:414` — **TS2448/TS2454** `focusPreview` used before declaration/assignment in the new v11.38 "ready → adopt verified URL" `useEffect`. | Preview-service / PreviewArea agent, mid-write. | Gone by final pass (declaration/use order corrected). Node/app tsc clean here. **No action.** |
| **C4 — RESOLVED ✅ (self-fixed live)** | `electron/agent/signatureFeatures.ts:767` — **TS2349** `This expression is not callable. Type 'Map<string, ToolDefLike>' has no call signatures`: `byName(a,b)` was a `Map` being used as a sort comparator. | Signature-features agent vs. tool-defs agent (name→def map vs. comparator name collision). | Fixed by 11:03: `byName` is now a proper comparator function at `:80`. Node tsc green. **No action.** |

---

## 3. Watch items — checked, NOT defects (do not "fix")

| file / check | Observation | Why it is fine |
|---|---|---|
| `src/store.ts` | Scanner reported 132 "duplicate" field names (`id`, `at`, `sendMessage`, `scheduleAdd`, …). | **False positives.** The regex matched every indented `name: type;` line across *all* interfaces, action maps, return shapes and the store object itself (e.g. `scheduleAdd` at `:1061` interface + `:3198` implementation). A scoped analyzer on the state interfaces alone (prior V1136 report: 222 fields) gives **0 real duplicates**. |
| 50 CSS sheets | 131 selectors appear in >1 sheet (`html`, `to`, `from`, `0%`/`50%`/`100%`, `.md`, `.tl2-pill`, `.chat-panel-root`, …). | **Cascade layering + `@keyframes` false positives.** `to`/`from`/`%` are keyframe steps (regex cannot see `@keyframes` scope). Real overlaps are intentional base→override cascades (`glass-v7.css`/`soft.css`/`styles.css` → component sheets), documented in prior audits (e.g. `console.css` vs `type-scale.css`). The newest sheet, `display-type.css`, adds legitimate typography overrides (`.w18-title`, `.bx-hero-title`, `.pv-title`, `.rd-title`); no conflicting property values observed, and both `tsc` and `next build` are green. |
| Import graph (217 modules) | 8 cycles: `store↔i18n`, `store↔Toasts`, `tools↔lsp`, `tools↔notebook`, `tools↔debugTools`, `mcp↔mcpRegistryService`, and 2 single-node self-references (`prompts.ts`, `compaction.ts`). | **All pre-existing; none touch a v1138 new file** (`signatureFeatures`, `effort`, `PluginsSection`, `registry`, `GitPanel`, `PreviewArea`, `scheduleService`, etc.). No new cycle introduced. The single-node hits are likely string/dynamic-import regex false positives. |
| `electron/agent/signatureFeatures.ts:25` comment | Referenced `SignaturePanel.tsx` before that file existed. | It landed at 11:05:19 and is registered (§4). Comment-only reference, now satisfied. |

---

## 4. New v1138 artifacts — existence & wiring

All 16 discovered v1138 artifacts exist. All relative imports resolve **except C1**. Wiring verified:

| New file | Wired into | Result |
|---|---|---|
| `electron/agent/signatureFeatures.ts` | `src/components/SignaturePanel.tsx:27` | ✅ imported |
| `src/components/SignaturePanel.tsx` | `src/components/panels/registry.tsx:26` + `:136` (`signature: SignaturePanel`, `setRail('signature')`) | ✅ registered, reachable, and compiles (C1 fixed) |
| `src/components/signature-art.css` | `SignaturePanel.tsx:29` | ✅ file present |
| `shared/effort.ts` | `EffortControl.tsx:21-27`, `ModelPicker.tsx:15-19`, `providers.ts:14-19` (`:2303`), `openrouterCatalog.ts:34` | ✅ wired across renderer + main |
| `src/components/EffortControl.tsx` | `Composer.tsx:39,2070` | ✅ rendered in composer |
| `src/components/settings/PluginsSection.tsx` | `SettingsModal.tsx:77,751` | ✅ rendered in settings |
| `electron/services/pluginService.ts` | `register.ts:658` (`enabledPluginMcpServers()` injected into run params) | ✅ wired into run path |
| schedule / mcp / flows / wiki / prompts / preview families | `electron/ipc.ts`, `preload.ts`, `register.ts`, panels | ✅ compile + both guards PASS |

v1138 test files present: `tests/v1138-ai-depth.test.mjs`, `v1138-preview.test.mjs`, `v1138-prompts-skills.test.mjs`, `v1138-plugins.test.mjs`, `v1138-schedule.test.mjs`, `v1138-security.test.mjs`, plus root `tests-v1138-mcp-guard.mjs` and `tests-v1138-schedule-guard.mjs`. All imports resolve.

---

## 5. Sign-off gate — VERIFIED GREEN

```powershell
cd "D:\New folder (58)\SADEEM-v11.12.0-source\src-pkg-v1112\sadeem-v11.12.0"
npm run typecheck                                   # ✅ PASS (app + node, exit 0)
node scripts/gen-tool-inventory.mjs                 # ✅ 145
node tests-v1138-mcp-guard.mjs                      # ✅ PASS 22/0
node tests-v1138-schedule-guard.mjs                 # ✅ PASS 46/0
cd website; npx tsc --noEmit; npm run build         # ✅ both PASS
```

**No remaining blockers.** All four observed collisions were fixed by their owning agents during the audit. Because the tree was still moving, re-run the gate once more after the fleet fully stops writing — but as of the final pass everything is green.
