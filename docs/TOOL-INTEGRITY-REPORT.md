# تقرير سلامة الأدوات / Tool Integrity Report

> SADEEM v11.12.0 source tree — read-only verification audit.
> Generated: 2026-11-19. Auditor: verification subagent. **No application file was modified.**
> Command under test: `node --test --test-force-exit tests/tool-coverage-all.mjs`

---

## ملخص تنفيذي / Executive summary

| Question | Answer | Evidence |
|---|---|---|
| Registry size | **145 tools** (fs 55 / exec 60 / meta 30) | `src/generated/toolInventory.json:3-8`; `electron/agent/tool-defs.ts:30-2022`; measured `getToolDefs([]) === 145` |
| `getToolDefs` counts | **full = 145**, **essential = 40**, **balanced = 120** | measured by bundling `electron/agent/tools.ts` and calling `getToolDefs([], profile)` |
| Profiles delete executors? | **No.** They only change the *advertised* `tools[]` list. `executeTool` has **no profile parameter** and resolves against the FULL registry. | `electron/agent/tool-defs.ts:2086-2092`; `electron/agent/tools.ts:676-699, 736-744`; `electron/agent/engine.ts:2058-2064` |
| Fixed-count tool narrowing | **None remains.** The bad 422 → `slice(0, 40)` fallback that existed at the start of this audit has been removed by A1 and replaced by a single-tool drop. | `electron/agent/providers.ts:1401-1475, 1697-1700, 1746-1765` (current) |
| Default profile | **`balanced`** | `electron/agent/engine.ts:2064`; `src/store.ts:4573`; `src/components/settings/AgentSection.tsx:87,168` |
| `balanced` covers founder's families? | **Yes** — web, download, all LSP, device/desktop, clipboard, screenshot. | measured family set (below) |
| Coverage test | **total=145 ok=86 honest-refusal=59 unknown=0**; 2/2 tests pass | TAP output + `tool-coverage.json` |

**Brutal bottom line:** every one of the 145 tools is reachable through `executeTool` (zero "Unknown tool", zero crashes, zero invalid-JSON failures). No tool is deleted by any profile. The 59 "honest-refusal" results are *correct refusals by the executor*, not unreachable tools — they are headless-environment limitations (no Electron window, missing `gh`/`python-docx`/`openpyxl`, bad fixture args), fully explained below.

---

## 1. عدد الأدوات / Registry count — 145

### Evidence

- `src/generated/toolInventory.json`:
  - `:3` → `"total": 145`
  - `:4-8` → `"kinds": { "fs": 55, "exec": 60, "meta": 30 }` → `55 + 60 + 30 = 145`.
  - `:9-161` → the three `groups` arrays; `:162-889` → the `tools[]` array.
- `electron/agent/tool-defs.ts:30-2022` → `export const CORE_DEFS: ToolDef[] = [ … ];` contains exactly **145** top-level `name:` entries.
- `scripts/gen-tool-inventory.mjs:12-14` parses `CORE_DEFS` out of `electron/agent/tool-defs.ts` (single source of truth) and `:56` writes `total: rows.length`. The generated inventory is therefore derived from the same array the agent runs, not hand-maintained.
- Independent runtime measurement (esbuild bundle of `electron/agent/tools.ts`, electron stub, `getToolDefs([])`): **145**, with **0 duplicate names** and **0 names present in a filtered profile but absent from full**.

### Honest notes

- `src/generated/toolInventory.json:2` was generated `2026-11-19T08:30:40.115Z` — current with the source.
- Version-label drift only (not functional): `electron/agent/tool-defs.ts:1` says "v11.15" inside a v11.12.0 tree; `:2` says "Was 118 at the v11.12 split". The count itself is correct at 145.

---

## 2. ملفات الأدوات / Tool Profiles — advertisement only, never deletion

### Mechanism (file:line)

- `electron/agent/tool-defs.ts:2038` → `export type ToolProfile = 'essential' | 'balanced' | 'full';`
- `electron/agent/tool-defs.ts:2041-2059` → `ESSENTIAL_TOOL_NAMES` (40 curated core tools).
- `electron/agent/tool-defs.ts:2066-2084` → `ADVANCED_TOOL_NAMES` (deep specialists hidden from `balanced` only).
- `electron/agent/tool-defs.ts:2086-2092` → `defsForProfile(defs, profile)`:
  - `:2088` `full` → `return defs;` (untouched),
  - `:2089` `essential` → `defs.filter(d => d.kind === 'mcp' || ESSENTIAL_TOOL_NAMES.has(d.name))`,
  - `:2091` `balanced` → `defs.filter(d => d.kind === 'mcp' || !ADVANCED_TOOL_NAMES.has(d.name))`.
  - **Name-set filters only — no count limit, no executor removal. MCP tools survive every profile.**
- `electron/agent/tools.ts:676-699` → `getToolDefs(enabledMcp, profile = 'full')` builds `CORE_DEFS` + MCP defs, then returns `defsForProfile(defs, profile)` at `:698`. Default is `'full'` so registry/inventory/tests stay complete.
- `electron/agent/tools.ts:736-744` → `executeTool(name, argsJson, ctx)` resolves the call with `getToolDefs(ctx.mcpServers)` — **default `'full'`**, no profile argument anywhere in the execution path. Aliases handled at `:732-734, 742`.
- `electron/agent/engine.ts:2058-2064` → the engine computes `const toolDefs = getToolDefs(enabledMcp, cfg.toolProfile ?? 'balanced');` **only** for what is sent to the model. Its own comment (`:2060-2063`) states: no executor is removed, the model can still call any tool by exact name, and `executeTool` resolves against the full registry.

### Measured counts

| Profile | Count | File:line that defines the filter |
|---|---|---|
| `full` | **145** | `tool-defs.ts:2088` |
| `essential` | **40** | `tool-defs.ts:2089` (+ `:2041-2059`) |
| `balanced` | **120** | `tool-defs.ts:2091` (+ `:2066-2084`) |

`balanced` = 145 − 25 real hidden specialists. `ADVANCED_TOOL_NAMES` lists 31 names; 6 of them (`csv_tool`, `base64_tool`, `regex_tool`, `diff_tool`, `color_tool`, `url_codec`) are **phantom names that are not tools in `CORE_DEFS`** — harmless, but sloppy. The 25 genuinely hidden tools are:
`debug_start, debug_state, debug_eval, debug_step, debug_stop, notebook_read, notebook_edit_cell, notebook_run, media_ffmpeg, pdf_make, pptx_make, docx_make, xlsx_make, export_project, diagnose_preview, browser_download, browser_console, browser_console_eval, browser_pdf, pdf_read, hash_file, text_stats, markdown_outline, json_format, image_search`.

They are hidden **from the list only** — all 25 remain callable by exact name.

### Conclusion (item 2)

`executeTool` can dispatch **all 145 tools even when the advertised profile is `essential`**: the profile value never reaches `executeTool` (its signature is `executeTool(name, argsJson, ctx)`), and it always resolves via `getToolDefs(ctx.mcpServers)` with the default `'full'`. Code path confirmed at `tools.ts:736-744` + `engine.ts:2064`.

### Honest caveat

The coverage test itself calls `executeTool` with the full registry (it does not spin up an `essential`-profile session). The "all 145 reachable under essential" claim is therefore proven **by code inspection** (no profile parameter in the dispatch path), not by an essential-profile runtime test.

---

## 3. تضييق ثابت العدد / Fixed-count narrowing — none besides the (now removed) 422 fallback

### The bad fallback (observed at the start of this audit, then already fixed by A1)

At first read, `electron/agent/providers.ts` contained, inside the `downgrade400` callback of `streamOpenAICompat`:

```ts
// v11.16 FIX: a strict gateway can 422 on a tool schema it cannot parse
// (e.g. tools[147]). Fall back to the ESSENTIAL tool subset (first 40)
if (/\btools\b|function\.parameters|literal_error|extra_forbidden/i.test(errText)) {
  const obj = JSON.parse(reqBody);
  if (Array.isArray(obj.tools) && obj.tools.length > 40) obj.tools = obj.tools.slice(0, 40);
}
```

That was a genuine integrity bug: one bad schema silently removed **105 of 145 tools** from the advertised wire request. On re-read during this same audit the code at `electron/agent/providers.ts:1746-1765` now reads:

- `:1753-1758` — comment: "Drop ONLY the offending tool … NEVER narrow the list to a fixed count".
- `:1759` `const badToolIndex = toolIndexFromValidationError(errText);`
- `:1760-1763` — if a `loc` index is parsed, `dropSingleRejectedTool(...)` is used; otherwise drop nothing and surface the honest error.
- `toolIndexFromValidationError` at `:1431-1456` extracts the one tool index from a Pydantic/FastAPI 422 `loc`.
- `dropSingleRejectedTool` at `:1463-1475` does `obj.tools.splice(index, 1)` at `:1469` — **one tool, never a fixed slice** — and remembers the name via `rememberSkippedTool` (`:1412-1419`).
- The remembered set is applied as a **name-based** filter in `buildOpenAIRequestBody` at `:1697-1700` (`a.tools.filter(t => !skippedTools.has(t.name))`).

Fresh grep for `slice(0, 40)`, `length > 40`, `first 40`, `ESSENTIAL tool subset` in `providers.ts`: **no matches**. A1's fix is present and complete as of this report.

### Every other `slice` / `filter` on tool-ish arrays, checked and cleared

| File:line | Code | Why it is NOT a fixed-count narrowing |
|---|---|---|
| `engine.ts:537` | `tools.slice(0, 14).join(', ')` | Only builds a *display string* inside `refusalRecoveryNudge` ("Available tools include: … and more"). Does not touch the advertised list or dispatch. |
| `engine.ts:2503` | `tools: toolDefs.filter(allowed)` | Subagent role scoping by predicate (`allowed`), not a fixed count. Deliberate specialist restriction. |
| `engine.ts:2854` | `toolDefs.filter(d => d.name === 'run_command' \|\| d.name === 'read_file')` | Verifier subagent intentionally limited to 2 tools; not the main agent surface. |
| `providers.ts:1469` | `obj.tools.splice(index, 1)` | Drops exactly ONE schema-named tool on 422 (A1 fix). |
| `providers.ts:1699` | `a.tools.filter(t => !skippedTools.has(t.name))` | Name-based skipped-set from the same 422 mechanism. |
| `tool-defs.ts:2089,2091` | `defs.filter(...)` | The profile mechanism itself — by name set, not count. |
| `tools.ts:1929, 4441-4442` | `.slice(0, 40)` | `tool_help` output cap for *search hits* ("… N more — narrow the query"); display only, and the full list is still queryable/callable. |
| `tools.ts:3493, 6482, 7613, 8286` | caps of 40 | Argument validation caps (edits per call, slides, packages) — unrelated to the tool registry. |

**Conclusion (item 3):** other than the 422 fallback that A1 has now removed, there is **no code path in `providers.ts`, `engine.ts`, or `tools.ts` that narrows the tool list to a fixed count**.

---

## 4. الملف الافتراضي وعائلات الأدوات / Default profile and required families

- Default is `balanced`: `engine.ts:2064` `cfg.toolProfile ?? 'balanced'`; `src/store.ts:4573` `s.settings.agent?.toolProfile ?? 'balanced'`; `src/components/settings/AgentSection.tsx:87,168`.
- Measured family coverage of **`balanced`** (and of `essential`, for contrast):

| Family | `balanced` (default) | `essential` (40) |
|---|---|---|
| Web | `web_search`, `web_fetch`, `http_request`, `search_web`, `web_download` | `web_search`, `web_fetch`, `web_download` |
| Download | `download_file`, `web_download` | `web_download` |
| LSP | **all 7**: `lsp_definition`, `lsp_hover`, `lsp_diagnostics`, `lsp_references`, `lsp_rename`, `lsp_completion`, `lsp_languages` | `lsp_languages` only (discoverability entry point) |
| Device / desktop | `screenshot`, `device_launch_app`, `clipboard_read`, `clipboard_write`, `desktop_control` | none |
| Media | `media_ffmpeg` is **hidden** from `balanced` (still callable by exact name) | hidden |

**Conclusion (item 4):** the founder's web / download / LSP / device needs are all satisfied by the **default `balanced` profile**. They are *not* all visible under `essential` — switching a weak model to `essential` hides the six `lsp_*` executors and every device tool (they remain callable, but an `essential` model is not told they exist). This is a deliberate trade-off, and `tool_help`/`lsp_languages` are included in `essential` precisely so the model can discover the hidden families.

### Honest UI-copy drift (documentation only, no functional impact)

- `src/components/CapabilityGuide.tsx:160` and `src/components/WhatsNew.tsx:26` say **"balanced (119)"** — actual measured value is **120**.
- `src/components/settings/AgentSection.tsx:327` says **"all 134 tools"** — actual is **145**; `:322` says "essential — ~30 core tools" — actual is **40**.
- `tool-defs.ts:2033` comment says "essential → ~40" (correct) and `:2036` says "full → all 145" (correct).

These strings are stale marketing/copy, not a tool-integrity failure. They are flagged so the founder does not confuse them with the real counts above.

---

## 5. نتيجة اختبار التغطية / Coverage test result (exact numbers)

Command (run in the project root, Windows/PowerShell, Node with experimental `node:sqlite`):

```
node --test --test-force-exit tests/tool-coverage-all.mjs
```

TAP summary:

```
# COVERAGE-RESULT: total=145 ok=86 honest-refusal=59 unknown=0
ok 1 - COVERAGE: all 145 tools dispatch through executeTool — ok or honest refusal, zero unknown, zero crashes
ok 2 - cleanup temp fixtures
# tests 2  # pass 2  # fail 0  # cancelled 0  # skipped 0  # todo 0
```

| Metric | Value |
|---|---|
| **total** | **145** |
| **ok** | **86** |
| **honest-refusal** | **59** |
| **unknown** | **0** |
| **crashes** | **0** |
| **invalid-json** | **0** |
| caught `Tool error:` guard outputs | **0** |

By kind (from the generated evidence file):

| kind | ok | honest-refusal | total |
|---|---|---|---|
| fs | 40 | 15 | 55 |
| exec | 22 | 38 | 60 |
| meta | 24 | 6 | 30 |
| **sum** | **86** | **59** | **145** |

Evidence artifacts written by the test: `/home/z/my-project/work/e2e-results/tool-coverage.json` and `tool-coverage.md` (on this Windows host the absolute path resolves under the current drive, e.g. `D:\home\z\my-project\work\e2e-results\`). Hard assertions in `tests/tool-coverage-all.mjs:454-469`: registry count === 145; `ENTRIES` exactly equals the 145 registry names; no duplicates; zero crashes / unknown / invalid-JSON; `ok + refusal === 145`.

### What the 59 honest refusals actually are

They are **executor-authored, well-formed answers**, not broken dispatch. Grouped:

- **Headless / Electron-only (expected in this test harness):** all `browser_*` tools (`SURNIA_NO_BROWSER=1`, no Electron window), `preview_screenshot`, `desktop_control`, `screenshot`, `device_launch_app`, `clipboard_read/write`, `notify_user`, `open_path`, `reveal_in_folder`, `ask_user`, `task`, `review_diff` — each says it is unavailable in this context.
- **Missing external CLI/module (honest install hint):** `create_pull_request`, `pr_status` (`gh` not installed); `docx_make` (`python-docx` missing); `xlsx_make` (`openpyxl` missing).
- **Bad/insufficient fixture args by design:** `process_kill` (nonexistent PID), `lsp_*` (nonexistent file), `notebook_*` (nonexistent file), `checkpoint_restore` (unknown id), `multi_file_edit` (empty array), `recall_result` (unknown id), `lint_check`/`export_project` (no config/build script), `db_query`/`db_seed`/`db_migrate`/`lighthouse`/`e2e_run`/`a11y_audit`/`env_manager`/`git_platform`/`icon_font_search`/`image_edit` (missing required params or no project dir), `debug_*` (no active session / breakpoint missed).

### Brutally honest limitations of this proof

1. **"ok" proves dispatch + an honest result, not full end-to-end capability.** 86 tools returned `ok` on this machine; 59 deliberately refused. A refusal such as `docx_make: python-docx not installed` means the capability is genuinely unavailable *here*, though the tool itself is reachable and tells the truth.
2. **GUI/device tools cannot be validated in headless mode.** Their honest refusals are the correct behavior; the test cannot prove they work inside the real Electron app, only that they are registered, dispatchable, and honest when unavailable.
3. **No test exercised an `essential`-profile session** (see item 2 caveat).
4. **Network-dependent tools** (`web_search`, `search_web`, `image_search`) landed in the ok/refusal set per this environment's network posture; their real-world result depends on external services.

---

## الحكم النهائي / Final verdict

- ✅ Registry is **145** tools; counts are **145 / 40 / 120** for full / essential / balanced.
- ✅ Tool Profiles are **advertising filters only** — no executor is deleted; `executeTool` can dispatch **all 145** under any profile.
- ✅ No fixed-count tool narrowing remains in `providers.ts` / `engine.ts` / `tools.ts`; A1's 422 fix replaced `slice(0,40)` with a single-schema drop.
- ✅ Default `balanced` includes web, download, all LSP and device families.
 ✅ Coverage: **total=145 ok=86 honest-refusal=59 unknown=0**, 2/2 tests pass.
- ⚠️ Honest caveats: 59 tools refuse correctly in headless mode; `essential` hides device + `lsp_*` from the model's list; stale UI copy says 119/134/≈30 instead of 120/145/40; 6 phantom names in `ADVANCED_TOOL_NAMES`.

**No application file was modified by this audit.** Only this report was created.
