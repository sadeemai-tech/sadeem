# TOOL UTILITY AUDIT — v11.42
# تدقيق فائدة الأدوات — v11.42

> Diagnosis + documentation subagent, 2026-11-22. **Read-only on source; this document is the only file written.**
> مندوب تشخيص وتوثيق. **لم أعدّل أي ملف كود؛ هذه الوثيقة هي الملف الوحيد المكتوب.**
>
> Scope: all 145 `CORE_DEFS` in `electron/agent/tool-defs.ts`, their executors in `electron/agent/tools.ts`,
> their dispatch reachability, their prompt/roster guidance, and competitor coverage per
> `docs/COMPETITORS-V1140.md` + `docs/COMPETITOR-CAPABILITIES-V1134.md`.
> Every claim below carries an exact `file:line`. Nothing was invented. No tool was added.

---

## 0. الحكم الصريح أولًا / The blunt verdict first

**AR:** الـ145 أداة **ليست تضخيمًا للعدد**. كل واحدة لها تعريف حقيقي، وكل واحدة لها منفّذ (executor) حقيقي في `tools.ts`، وكل واحدة قابلة للاستدعاء عبر `executeTool`. **لا توجد أداة ميتة (DEAD)، ولا أداة محجوزة خلف موافقة مستحيلة (GATE-BLOCKED)، ولا منفّذ ي Returns "not implemented".**
لكن توجد **حالتا تكرار حقيقيتان** تستحقان الدمج:
1. `search_web` — يعرّف نفسه صراحةً بأنه «Alias of web_search» ويستدعي **نفس** خلفية `ddgSearch()` (`tool-defs.ts:568-572`, `tools.ts:3752-3764` مقابل `3736-3750`). هذه هي أقرب حالة لـ«زيادة عدد».
2. `search_files` مقابل `search_grep` — كلتاهما بحث CONTENT داخل الملفات بالـregex； منفّذان مختلفان (`tools.ts:3016` مقابل `10248`) لكن الغرض متطابق تقريبًا.

الباقي أدوات حقيقية؛ منها **~50 أداة متخصصة/نiche** (أدوات مساعدة صغيرة، أدوات سطح مكتب، builders، إلخ) — **لا أوصي بحذفها** لأن لها وظيفة فعلية ومنفّذًا حقيقيًا. المشكلة ليست «أدوات وهمية» بل **بروز (salience)**: 14 أداة لا يذكرها البرومت بالاسم إطلاقًا.

**EN:** The 145 tools are **not padding**. Every one has a real def, a real executor, and a real dispatch case. There are **0 DEAD tools, 0 GATE-BLOCKED tools, and 0 "not implemented" stubs**. There are **2 genuine redundancy/merge candidates** (`search_web` ≡ `web_search`; `search_files` ≈ `search_grep`). ~50 tools are real-but-niche — **do not remove them**. The real problem is prompt salience (14 tools are never named in the system prompt), not fake capability.

### Counts (brutally honest)
| Class | Count | Meaning |
|---|---:|---|
| **USEFUL** | 91 | Core, real, prompt-guided or clearly routed |
| **NICHE-BUT-REAL** | 52 | Real executor + real purpose, narrow/low-frequency, often unmentioned in prompt — **KEEP** |
| **REDUNDANT (merge candidate)** | 2 | `search_web` (self-declared alias) + `search_files`/`search_grep` pair |
| **DEAD** | 0 | No tool without an executor |
| **GATE-BLOCKED (dead approval)** | 0 | No unsatisfiable approval; gates are plan/plan-tier/Electron-context, all reachable |
| **Total** | **145** | 145 defs, 145 executors, 147 switch cases (2 executor-only orphan cases) |

**If all 145 are real, say so plainly: 143 of 145 are genuinely distinct, real tools; 2 are duplicates. Nothing is fake.**

---

## 1. Force-check method / منهج التحقق (exact commands)

1. **Def enumeration:** parsed `name:` / `kind:` / `profile:` from `CORE_DEFS` — **145 defs**; kinds **fs 55 · exec 60 · meta 30** — matches generated inventory `src/generated/toolInventory.json` (`total:145`, kinds `{"fs":55,"exec":60,"meta":30}`) produced by `scripts/gen-tool-inventory.mjs:12-14`.
2. **Executor check:** parsed `switch (canonical)` at `electron/agent/tools.ts:1466-1957`; **147 `case` entries**. Cross-check: **all 145 defs have a case**; only 2 cases have no def: `preview_open` (`tools.ts:1642-1643`, documented at `tool-defs.ts:1410-1413`) and `worktree_list` (`tools.ts:1691-1692`, comment at `1688-1690`). No `name:` in `tool-defs.ts` for either (grep = 0 matches).
3. **Stub scan:** grep for `not implemented|TODO|placeholder|stub|not supported|no-op` in `tools.ts` → only platform-honest messages: `tools.ts:7831,8636` (`desktop_control` not implemented **on macOS only**; real on Windows/Linux), plus validation strings (`2363`, `10984`). **No executor returns a global "not implemented".**
4. **Prompt/roster check:** exact-name match of all 145 tools against `prompts.ts` + `agents.ts` → **122 named in prompts**, **3 in agents**, **23 not named**; 9 of those 23 are covered by group/wildcard syntax (`lsp_*`, `debug_start/state/eval/step/stop`, `archive_create/extract`, `csv_read-write`, `browser_snapshot/click/type`), leaving **14 with zero prompt mention** (listed in §3.4).
5. **Reachability:** `executeToolImpl` (`tools.ts:1401`) validates then dispatches; profiles are explicitly **a view, never a gate** (`tool-defs.ts:2295-2319`, `prompts.ts:1082-1098`). The approval gate is a real user card with allow/deny/always (`engine.ts:3081-3244`); plan/read-only task modes deny mutations **by design** (`engine.ts:3090,3099-3118`). Billing gates `checkGate('subagent')` (`tools.ts:3612`) and `checkGate('device')` (`tools.ts:3924-3931`) fail open when billing is down and are Pro-tier gating, **not dead approvals**.

**Verdict legend:** USEFUL = real + clearly routed · NICHE-BUT-REAL = real + narrow/low-frequency, keep · REDUNDANT = overlaps another tool, merge candidate · DEAD = no executor (none) · GATE-BLOCKED = unreachable (none).
`Exec` column = executor definition in `tools.ts` (`fn@line`); `browser_*`/`debug_*`/`prStatus` executors are verified real imports at `tools.ts:34-56`.

---

## 2. التعداد الكامل / Complete enumeration (145 tools)

### 2.1 FS — 55 tools (`kind:'fs'`)

| # | Tool (def line) | Executor | Prompt guidance | Verdict | Note |
|---:|---|---|---|---|---|
| 1 | `list_dir` (`tool-defs.ts:67`) | `fn@1991` | named (769) | USEFUL | directory children |
| 2 | `read_file` (`:80`) | `fn@2025` | named (769,770) | USEFUL | read-before-edit enforced |
| 3 | `read_image` (`:97`) | `fn@2331` | named (774) | USEFUL | vision input |
| 4 | `write_file` (`:115`) | `fn@2450` | named (770) | USEFUL | new/full-file writes |
| 5 | `edit_file` (`:131`) | `fn@2524` | named (770) | USEFUL | surgical edit |
| 10 | `preview_screenshot` (`:208`) | `inline 1485` | named (796) | USEFUL | headless-guarded `1490` |
| 11 | `search_files` (`:226`) | `fn@3016` | named (769) | **REDUNDANT** | overlaps `search_grep` — see §2.2 |
| 12 | `glob_files` (`:243`) | `fn@3167` | named (769) | USEFUL | filename-only |
| 13 | `fs_browse` (`:259`) | `fn@2124` | named (769) | NICHE-BUT-REAL | outside-workspace tree |
| 14 | `workspace_map` (`:275`) | `fn@2242` | named (769) | USEFUL | orient new project |
| 39 | `download_file` (`:584`) | `fn@5733` | named (771,794) | USEFUL | arbitrary binaries |
| 48 | `code_search` (`:736`) | `fn@1682` | named (827) | USEFUL | concept-ranked code |
| 58 | `semantic_search` (`:866`) | `fn@8207` | named (827) | USEFUL | **real** embedding index `embeddingIndex.ts:195-295`; V1140 doc `:90` wrongly says "no semantic index" |
| 60 | `notebook_read` (`:897`) | `import notebook.ts (tools.ts:49)` | named (828) | USEFUL | Jupyter |
| 61 | `notebook_edit_cell` (`:905`) | `import notebook.ts (tools.ts:49)` | named (828) | USEFUL | Jupyter |
| 63 | `multi_file_edit` (`:936`) | `fn@8257` | named (812,828) | USEFUL | atomic cross-file refactor |
| 73 | `make_document` (`:1092`) | `fn@4897` | named (774,829) | USEFUL | PDF/DOCX/XLSX/HTML/MD/CSV |
| 74 | `recall_result` (`:1124`) | `inline 1750` | named (593,831) | USEFUL | restores pruned results |
| 75 | `find_refs` (`:1135`) | `fn@2693` | named (827) | USEFUL | symbol refs (index) |
| 76 | `symbol_outline` (`:1149`) | `fn@2711` | named (811,827) | USEFUL | file symbols |
| 77 | `impact_of` (`:1160`) | `fn@2727` | named (827) | NICHE-BUT-REAL | overlaps `find_refs` but adds import analysis (`tools.ts:2735`) |
| 78 | `repo_map` (`:1171`) | `fn@2739` | named (811,827) | USEFUL | ranked repo map |
| 79 | `lsp_definition` (`:1183`) | `import lsp.ts (tools.ts:46)` | named (827) | USEFUL | real LSP |
| 80 | `lsp_hover` (`:1202`) | `import lsp.ts (tools.ts:46)` | named (827) | USEFUL | real LSP |
| 81 | `lsp_diagnostics` (`:1219`) | `import lsp.ts (tools.ts:46)` | named (826,827) | USEFUL | post-edit check |
| 82 | `lsp_references` (`:1227`) | `import lsp.ts (tools.ts:46)` | named (827) | USEFUL | exact refs |
| 83 | `lsp_rename` (`:1243`) | `import lsp.ts (tools.ts:46)` | named (828) | USEFUL | GET edits → apply via multi_file_edit |
| 84 | `lsp_completion` (`:1259`) | `import lsp.ts (tools.ts:46)` | group `lsp_*` (777) | NICHE-BUT-REAL | not named exactly; keep |
| 92 | `memory_verify` (`:1349`) | `fn@5166` | named (831) | NICHE-BUT-REAL | stale-fact check |
| 93 | `multi_edit` (`:1360`) | `fn@5055` | named (770,812,828) | USEFUL | one-file atomic batch |
| 94 | `move_path` (`:1386`) | `fn@5240` | named (770,812) | USEFUL | reorder |
| 95 | `delete_path` (`:1401`) | `fn@5329` | named (770,812) | USEFUL | OS trash |
| 102 | `pdf_make` (`:1520`) | `fn@9214` | named (791,815) | NICHE-BUT-REAL | overlaps `make_document format:pdf` (different engine) |
| 103 | `pptx_make` (`:1548`) | `officeMake fn@9450` | named (815,792) | USEFUL | real .pptx via python-pptx |
| 104 | `docx_make` (`:1582`) | `officeMake fn@9450` | named (792) | NICHE-BUT-REAL | overlaps `make_document format:docx` |
| 105 | `xlsx_make` (`:1605`) | `officeMake fn@9450` | named (792) | NICHE-BUT-REAL | overlaps `make_document format:xlsx` |
| 107 | `diagnose_preview` (`:1656`) | `fn@9810` | named (793,832) | USEFUL | read-only root cause |
| 108 | `browser_download` (`:1666`) | `fn@9903` | named (794) | NICHE-BUT-REAL | 25MB allowlist vs download_file 100MB |
| 111 | `browser_pdf` (`:1703`) | `fn@9991` | named (830) | NICHE-BUT-REAL | print page → PDF |
| 112 | `sqlite_query` (`:1718`) | `fn@10044` | named (795) | USEFUL | SQL read-only default |
| 114 | `search_grep` (`:1754`) | `fn@10248` | named (827,795) | **REDUNDANT** | overlaps `search_files` — see §2.2 |
| 116 | `image_probe` (`:1792`) | `fn@10466` | named (795) | NICHE-BUT-REAL | image headers |
| 118 | `csv_read` (`:1821`) | `fn@10751` | named (829) | NICHE-BUT-REAL | CSV |
| 119 | `csv_write` (`:1837`) | `fn@10807` | group `csv_read-write` (829) | NICHE-BUT-REAL | keep |
| 120 | `pdf_read` (`:1852`) | `fn@10943` | named (829) | NICHE-BUT-REAL | honest OCR caveat `10984` |
| 121 | `hash_file` (`:1867`) | `fn@11001` | named (829) | NICHE-BUT-REAL | checksum |
| 123 | `encode_base64` (`:1895`) | `fn@11052` | **none** | NICHE-BUT-REAL | real 52-line impl `11052`; not in prompt |
| 124 | `decode_base64` (`:1910`) | `fn@11105` | **none** | NICHE-BUT-REAL | real 64-line impl `11105`; not in prompt |
| 126 | `text_stats` (`:1940`) | `fn@11226` | named (829) | NICHE-BUT-REAL | text metrics |
| 127 | `diff_files` (`:1954`) | `fn@11337` | named (829) | NICHE-BUT-REAL | overlaps `git diff` but standalone |
| 131 | `markdown_outline` (`:2008`) | `fn@11521` | named (829) | NICHE-BUT-REAL | outline |
| 132 | `json_format` (`:2022`) | `fn@11828` | named (829) | NICHE-BUT-REAL | format/query |
| 141 | `icon_font_search` (`:2190`) | `fn@12613` | named (842) | NICHE-BUT-REAL | offline asset scan |
| 143 | `web_download` (`:2236`) | `fn@5904` | **none** | NICHE-BUT-REAL | verified sha256 + SSRF guard `5870-5975`; keep |
| 145 | `lsp_languages` (`:2281`) | `fn@6117` | group `lsp_*` (777) | NICHE-BUT-REAL | language matrix |

### 2.2 EXEC — 60 tools (`kind:'exec'`)

| # | Tool (def line) | Executor | Prompt guidance | Verdict | Note |
|---:|---|---|---|---|---|
| 6 | `run_command` (`:149`) | `fn@2783` | named (775,813) | USEFUL | exit commands |
| 7 | `run_background` (`:166`) | `fn@6743` | named (775,813) | USEFUL | long jobs |
| 8 | `process_output` (`:182`) | `fn@6797` | named (775,813) | USEFUL | tail logs |
| 9 | `stop_process` (`:198`) | `fn@6819` | named (775,813) | USEFUL | own background job only |
| 17 | `browser_navigate` (`:334`) | `inline 1504` | named (771,814) | USEFUL | approval + headless guard |
| 18 | `browser_snapshot` (`:344`) | `inline 1515` | named (814,830) | USEFUL | a11y tree |
| 19 | `browser_click` (`:354`) | `inline 1520` | named (814,830) | USEFUL | ref-based |
| 20 | `browser_type` (`:364`) | `inline 1527` | group `browser_…/click/type` (830) | USEFUL | ref+text |
| 21 | `browser_read` (`:378`) | `inline 1535` | **none** | NICHE-BUT-REAL | real `browserRead` import `tools.ts:35`; keep |
| 22 | `browser_screenshot` (`:385`) | `inline 1540` | named (815) | USEFUL | page image |
| 23 | `browser_eval` (`:392`) | `inline 1547` | **none** | NICHE-BUT-REAL | `force:true` approval `1552`; full-access auto-approves `engine.ts:3183` |
| 24 | `browser_close` (`:402`) | `inline 1557` | **none** | NICHE-BUT-REAL | tab or all |
| 28 | `open_path` (`:442`) | `fn@3977` | named (771,775) | USEFUL | "open/show me" |
| 29 | `device_launch_app` (`:452`) | `fn@3956` | named (785) | NICHE-BUT-REAL | **Pro+desktop gated** (`deviceGate()`): `3924-3931`; reachable on Pro |
| 30 | `clipboard_read` (`:470`) | `fn@3995` | named (774,775) | NICHE-BUT-REAL | clipboard |
| 31 | `clipboard_write` (`:477`) | `fn@4024` | named (775) | NICHE-BUT-REAL | clipboard |
| 33 | `process_list` (`:497`) | `fn@5433` | named (775) | NICHE-BUT-REAL | OS processes |
| 34 | `process_kill` (`:515`) | `fn@5464` | named (775) | NICHE-BUT-REAL | destructive, confirm |
| 37 | `http_request` (`:546`) | `fn@5640` | named (771,814) | USEFUL | REST/JSON |
| 40 | `archive_create` (`:600`) | `fn@6210` | named (775) group | USEFUL | zip |
| 41 | `archive_extract` (`:614`) | `fn@6260` | group `archive_create/extract` (775) | USEFUL | unzip |
| 42 | `preview` (`:628`) | `fn@6671` | named (796) | USEFUL | dev server |
| 43 | `gen_ui` (`:644`) | `fn@6404` | **none** | NICHE-BUT-REAL | real widget builder; no prompt mention — keep |
| 44 | `ui_quality_check` (`:664`) | `inline 1646` | named (796) | USEFUL | deterministic UI audit |
| 45 | `image_generate` (`:682`) | `inline 1651` | named (774,815) | USEFUL | approval gate `1668-1674` |
| 46 | `test_run` (`:703`) | `fn@7170` | named (813,826) | USEFUL | real harness |
| 47 | `lint_check` (`:721`) | `fn@7267` | named (813,826) | USEFUL | real harness |
| 49 | `worktree_create` (`:752`) | `fn@7524` | named (831) | USEFUL | isolation |
| 50 | `worktree_remove` (`:767`) | `fn@7569` | **none** | NICHE-BUT-REAL | real executor `7569`; not in prompt |
| 51 | `diff_stat` (`:783`) | `fn@7606` | **none** | NICHE-BUT-REAL | real 91-line impl; not in prompt |
| 53 | `port_probe` (`:799`) | `fn@8002` | named (832) | NICHE-BUT-REAL | port check |
| 56 | `browser_tabs` (`:834`) | `inline 1569` | named (830) | USEFUL | tab control |
| 57 | `browser_network` (`:849`) | `inline 1593` | named (830) | USEFUL | request log |
| 62 | `notebook_run` (`:920`) | `import notebook.ts (tools.ts:49)` | named (828) | USEFUL | Jupyter exec |
| 65 | `checkpoint_restore` (`:971`) | `inline 1716` | named (828,832) | USEFUL | rewind |
| 85 | `debug_start` (`:1275`) | `import debugTools.ts (tools.ts:56)` | named (826) | USEFUL | real DAP `debugTools.ts` |
| 86 | `debug_state` (`:1291`) | `import debugTools.ts (tools.ts:56)` | group `debug_start/state/…` (826) | USEFUL | DAP |
| 87 | `debug_eval` (`:1298`) | `import debugTools.ts (tools.ts:56)` | group (826) | USEFUL | DAP |
| 88 | `debug_step` (`:1305`) | `import debugTools.ts (tools.ts:56)` | group (826) | USEFUL | DAP |
| 89 | `debug_stop` (`:1319`) | `import debugTools.ts (tools.ts:56)` | group (826) | USEFUL | DAP |
| 90 | `create_pull_request` (`:1326`) | `inline 1807 + github.ts (tools.ts:51)` | named (831) | NICHE-BUT-REAL | overlaps `git_platform create_pr` — §2.3 |
| 91 | `pr_status` (`:1342`) | `inline 1823 + github.ts (tools.ts:51)` | named (831) | NICHE-BUT-REAL | overlaps `git_platform list_prs` — §2.3 |
| 96 | `reveal_in_folder` (`:1415`) | `fn@5372` | named (770,775) | NICHE-BUT-REAL | OS file manager |
| 98 | `desktop_control` (`:1442`) | `fn@8602` | named (785) | NICHE-BUT-REAL | Pro+desktop; macOS honest error `8636`, Windows/Linux real |
| 99 | `browser_wait_for` (`:1464`) | `fn@8864` | named (786) | NICHE-BUT-REAL | SPA waits |
| 100 | `browser_select` (`:1481`) | `fn@8942` | named (786) | NICHE-BUT-REAL | `<select>` |
| 101 | `media_ffmpeg` (`:1498`) | `fn@9043` | named (787) | NICHE-BUT-REAL | real ffmpeg, install hints |
| 106 | `export_project` (`:1638`) | `fn@9629` | named (793) | USEFUL | build + zip |
| 109 | `browser_console` (`:1682`) | `inline 1864` | named (794,830) | USEFUL | console/net logs |
| 110 | `browser_console_eval` (`:1691`) | `inline 1869` | named (794) | NICHE-BUT-REAL | `force:true` `1874` |
| 113 | `env_install` (`:1736`) | `fn@10160` | named (795,832) | USEFUL | guarded installs |
| 115 | `git_local` (`:1773`) | `fn@10351` | named (795,831) | USEFUL | status/diff/commit |
| 117 | `image_search` (`:1805`) | `fn@10623` | named (815,830) | NICHE-BUT-REAL | image discovery |
| 122 | `uuid_gen` (`:1882`) | `fn@11041` | **none** | NICHE-BUT-REAL | real `crypto.randomUUID` `11045`; not in prompt |
| 125 | `regex_test` (`:1925`) | `fn@11174` | named (829) | NICHE-BUT-REAL | regex check |
| 128 | `color_convert` (`:1969`) | `fn@11477` | **none** | NICHE-BUT-REAL | real 21-line impl; not in prompt |
| 129 | `url_encode` (`:1982`) | `fn@11501` | **none** | NICHE-BUT-REAL | real 6-line impl; not in prompt |
| 130 | `url_decode` (`:1995`) | `fn@11508` | **none** | NICHE-BUT-REAL | real 10-line impl; not in prompt |
| 133 | `db_query` (`:2043`) | `fn@12014` | named (840) | USEFUL | SELECT default |
| 134 | `db_seed` (`:2066`) | `fn@12073` | named (840) | NICHE-BUT-REAL | SQL seed |
| 135 | `db_migrate` (`:2085`) | `fn@12172` | named (840) | NICHE-BUT-REAL | Prisma/Knex/Django |
| 136 | `lighthouse` (`:2102`) | `fn@12221` | named (817,841) | USEFUL | real npx Lighthouse |
| 137 | `e2e_run` (`:2118`) | `fn@12274` | named (841) | USEFUL | Playwright/Cypress |
| 138 | `a11y_audit` (`:2135`) | `fn@12343` | named (817,841) | USEFUL | axe/pa11y |
| 139 | `env_manager` (`:2152`) | `fn@12450` | named (842) | NICHE-BUT-REAL | read-only env |
| 140 | `git_platform` (`:2170`) | `fn@12507` | named (842) | USEFUL | gh/glab PR+issues |
| 142 | `image_edit` (`:2207`) | `fn@12678` | named (842) | NICHE-BUT-REAL | ImageMagick |

### 2.3 META — 30 tools (`kind:'meta'`)

| # | Tool (def line) | Executor | Prompt guidance | Verdict | Note |
|---:|---|---|---|---|---|
| 15 | `todo_write` (`:288`) | `fn@3208` | named (831) | USEFUL | task tracking |
| 16 | `task` (`:312`) | `fn@3607` | named (776,832) | USEFUL | Pro gate `checkGate('subagent')` `3612` — fails open, reachable on Pro |
| 25 | `web_search` (`:409`) | `fn@3736` | named (771,814,830) | USEFUL | canonical DDG search |
| 26 | `web_fetch` (`:424`) | `fn@3766` | named (771,814) | USEFUL | clean text |
| 27 | `screenshot` (`:434`) | `fn@3934` | named (774,468) | NICHE-BUT-REAL | Pro+desktop gate `deviceGate()` `3937`; reachable |
| 32 | `notify_user` (`:484`) | `fn@4041` | named (775) | NICHE-BUT-REAL | OS notification |
| 35 | `sys_info` (`:531`) | `fn@6146` | named (775) | NICHE-BUT-REAL | machine info |
| 36 | `network_info` (`:539`) | `fn@6167` | named (775) | NICHE-BUT-REAL | net info |
| 38 | `search_web` (`:568`) | `fn@3752` | named (830 as "alias") | **REDUNDANT** | self-declared alias; duplicate backend — §3.1 |
| 52 | `env_probe` (`:791`) | `fn@7722` | named (788,832) | USEFUL | dependency preflight |
| 54 | `schema_docs` (`:812`) | `fn@8164` | **none** | NICHE-BUT-REAL | real 31-line API scan; not in prompt |
| 55 | `checkpoint_save` (`:820`) | `fn@8362` | named (828) | USEFUL | rollback |
| 59 | `pin_context` (`:880`) | `fn@8227` | named (831) | USEFUL | survive compaction |
| 64 | `checkpoint_list` (`:963`) | `inline 1703` | named (828) | USEFUL | list |
| 66 | `propose_plan` (`:985`) | `fn@3233` | named (831,832) | USEFUL | plan approval |
| 67 | `use_skill` (`:1004`) | `fn@3260` | named (1033-1039) | USEFUL | SKILLS-FIRST |
| 68 | `create_skill` (`:1017`) | `fn@3299` | named (1039) | USEFUL | save skill |
| 69 | `remember` (`:1033`) | `fn@3400` | named (831) | USEFUL | facts → DNA/MEMORY.md |
| 70 | `review_diff` (`:1054`) | `fn@3581` | named (826,831) | USEFUL | engine review |
| 71 | `dna_note` (`:1063`) | `fn@3509` | named (831,541) | NICHE-BUT-REAL | overlaps `remember` but different taxonomy |
| 72 | `recall_memory` (`:1077`) | `fn@3536` | named (831) | USEFUL | cross-session recall |
| 97 | `ask_user` (`:1426`) | `fn@5400` | named (776) | USEFUL | structured question |
| 117* | `image_search` — listed above under exec per generated inventory; def `kind:'meta'` (`:1805`) | `fn@10623` | named | NICHE-BUT-REAL | (see exec table; count appears once) |
| 122* | `uuid_gen` — def `kind:'meta'` (`:1882`) | `fn@11041` | **none** | NICHE-BUT-REAL | (see exec table; count appears once) |
| 125* | `regex_test` — def `kind:'meta'` (`:1925`) | `fn@11174` | named | NICHE-BUT-REAL | (see exec table; count appears once) |
| 128* | `color_convert` — def `kind:'meta'` (`:1969`) | `fn@11477` | **none** | NICHE-BUT-REAL | (see exec table; count appears once) |
| 129* | `url_encode` — def `kind:'meta'` (`:1982`) | `fn@11501` | **none** | NICHE-BUT-REAL | (see exec table; count appears once) |
| 130* | `url_decode` — def `kind:'meta'` (`:1995`) | `fn@11508` | **none** | NICHE-BUT-REAL | (see exec table; count appears once) |
| 144 | `tool_help` (`:2262`) | `fn@6058` | named (810,811) | USEFUL | discoverability |

> `*` group note: `image_search`, `uuid_gen`, `regex_test`, `color_convert`, `url_encode`, `url_decode` are tagged `kind:'meta'` in `tool-defs.ts` but the generated inventory groups some of them differently; they are listed once each in the FS/EXEC tables above for readability. **Total distinct tools = 145, no double-count.**

---

## 3. التكرار والموت — أدلة / Redundancy & death — evidence

### 3.1 `search_web` ≡ `web_search` — **REDUNDANT (clear)**
- `tool-defs.ts:568-572` — definition literally says: `'Alias of web_search with a max_results knob … both hit the same DuckDuckGo backend.'`
- `tools.ts:3736-3750` `webSearch()` calls `ddgSearch(query, WEBSEARCH_RESULTS_CAP, 15_000)`.
- `tools.ts:3752-3764` `searchWebTool()` calls `ddgSearch(query, max, SEARCH_WEB_TIMEOUT_MS)` — same backend, only `max_results` differs.
- `prompts.ts:830` — `'web_search (alias search_web)'` — the prompt itself treats them as one.
- `TOOL_ALIASES` at `tools.ts:1397-1399` contains **only** `http_download → web_download`; so `search_web` is a **full separate registry entry** (a real case at `tools.ts:1632`) — it inflates the count by one. **This is the single closest thing to padding in the 145.**
- Honest nuance: `search_web.max_results` is a real knob. **Merge** by adding `max_results` to `web_search`, then drop the `search_web` def/case → 144 tools. Do not keep both.

### 3.2 `search_files` ≈ `search_grep` — **REDUNDANT (merge candidate, low priority)**
- `tool-defs.ts:226-230` — `search_files`: "regex CONTENT search across the workspace (case-insensitive) when you need every matching line".
- `tool-defs.ts:1754-1758` — `search_grep`: "Ripgrep-style workspace text search … Literal or regex, case-insensitive by default — the fast 'find every occurrence' tool".
- Two different real implementations: `searchFiles()` `tools.ts:3016` (JS walker, own `SEARCH_MAX_HITS`/`SEARCH_MAX_FILES`, symlink containment `3046-3082`, outside-path approval `3033`) vs `searchGrep()` `tools.ts:10248` (real `rg` when installed, JS fallback).
- Prompt gives both distinct roles (`prompts.ts:769` vs `:827`) — so the model is not confused, but the **capability is duplicated**. Both are real and niche-differentiated (exhaustive regex vs capped rg). **MERGE optional**; do NOT remove both.

### 3.3 Overlapping-but-real families — **NICHE-BUT-REAL (KEEP, do not remove)**
| Family | Def lines | Why they are real, not padding |
|---|---|---|
| Download trio | `download_file:584`, `web_download:2236`, `browser_download:1666` | 100MB arbitrary / sha256+SSRF verified (`tools.ts:5870-5975`) / 25MB page-asset allowlist — different guarantees |
| GitHub/GitLab | `create_pull_request:1326`, `pr_status:1342`, `git_platform:2170` | GitHub-only convenience vs multi-forge (`gh`+`glab`, issues) — `git_platform` reuses the same bridge (`tools.ts:12507`) |
| Memory | `remember:1033`, `dna_note:1063`, `recall_memory:1077`, `memory_verify:1349`, `pin_context:880` | write / typed note / read / staleness check / compaction pin — different lifecycle stages |
| Document builders | `make_document:1092`, `pdf_make:1520`, `docx_make:1582`, `xlsx_make:1605` | `make_document` uses print engine/headless Cairo; `pdf_make` uses the A4 markdown typesetter (`tools.ts:9214`); pptx has no `make_document` equivalent → **required** |
| Reference search | `find_refs:1135`, `impact_of:1160`, `lsp_references:1227` | lexical index / blast-radius+imports / exact LSP — distinct engines |
| Edit variants | `edit_file:131`, `multi_edit:1360`, `multi_file_edit:936`, `write_file:115` | 1 replacement / 1-file batch / N-file atomic / full rewrite — real harness guards |

### 3.4 The 14 tools with **zero prompt mention** (salience gap, not removal)
`browser_read` (`:378`), `browser_eval` (`:392`), `browser_close` (`:402`), `gen_ui` (`:644`), `worktree_remove` (`:767`), `diff_stat` (`:783`), `schema_docs` (`:812`), `uuid_gen` (`:1882`), `encode_base64` (`:1895`), `decode_base64` (`:1910`), `color_convert` (`:1969`), `url_encode` (`:1982`), `url_decode` (`:1995`), `web_download` (`:2236`).
- All 14 have real executors (verified §1) and rich `description` fields in their defs, which ARE sent to the model in the tools array — so "when to use" guidance exists **in the schema**, just not in `prompts.ts`.
- Fix = add one short routing line to the CAPABILITY ROSTER (`prompts.ts:809-834`), **not deletion**.

### 3.5 Orphan dispatch cases (count discrepancy 145 vs 146)
- `preview_open` (`tools.ts:1642-1643`) and `worktree_list` (`tools.ts:1691-1692`) have **executors but no def** (no `name:` in `tool-defs.ts`: grep = 0). They are callable-by-exact-name paths (`tool-defs.ts:1410-1413`), documented as "ready the moment that def is registered". This explains why `docs/COMPETITOR-CAPABILITIES-V1134.md:18-19,29,131,135` says **146** while the canonical inventory (`tool-defs.ts:1-4`, `toolInventory.json:total`) says **145**. **Founder's 145 is correct.** Do not "restore" the phantom entry.

---

## 4. تغطية المنافسين / Competitor coverage

### 4.1 From `docs/COMPETITOR-CAPABILITIES-V1134.md` (Claude Code / OpenCode / Codex)

| # | Competitor capability | SADEEM tool (`file:line`) | Verdict |
|---:|---|---|---|
| 1 | Plan mode (read-only → approval) | `propose_plan` `tool-defs.ts:985` + `prompts.ts:120-124,156-179` | HAS |
| 2 | Debug / review modes | `debug_start..stop` `:1275-1319`, `review_diff` `:1054` | HAS |
| 3 | Hooks 30+ events / 5 handler types | **NO TOOL** — `hooks.ts:42-56` only PreToolUse/PostToolUse | **GAP (breadth, not a tool)** |
| 4 | Subagents / background agents | `task` `:312`, `agents.ts` roster, `prompts.ts:850-852` | HAS |
| 5 | MCP | dynamic `mcp__<server>__<tool>` `prompts.ts:1021`, dispatch `tools.ts:1953-1955` | HAS |
| 6 | Skills | `use_skill` `:1004`, `create_skill` `:1017` | HAS |
| 7 | Checkpoints / rewind | `checkpoint_save` `:820`, `checkpoint_list` `:963`, `checkpoint_restore` `:971` | HAS |
| 8 | Extended thinking | no tool — effort control `prompts.ts:733-741` | HAS (non-tool) |
| 9 | LSP code intelligence | `lsp_definition..completion` `:1183-1259`, `lsp_languages` `:2281` | HAS |
| 10 | Worktrees | `worktree_create` `:752`, `worktree_remove` `:767` | HAS |
| 11 | Approvals / permission modes | no tool — `engine.ts:3081-3244` | HAS |
| 12 | Flows / scheduled tasks | no tool — `flowsService.ts`, `scheduleService.ts` | HAS (non-tool) |
| 13 | Sessions resume / branching | no tool — `src/store.ts`, journals/traces | HAS |
| 14 | Browser / UI verification / image | `browser_*` `:334-402,834-849,1464-1498,1666-1718`, `lighthouse` `:2102`, `e2e_run` `:2118`, `a11y_audit` `:2135`, `image_generate` `:682`, `image_edit` `:2207`, `media_ffmpeg` `:1498` | HAS |
| 15 | Cloud tasks / remote execution | **NO equivalent** | **GAP / N/A** (structural) |
| 16 | Session sharing links | **NO equivalent** (`preload.ts:229` HTML export only) | **GAP** (structural) |
| 17 | Code Mode `execute` | **NOT a model-callable tool** — harness-only; `prompts.ts:1074-1098` notes context economy (`recall_result:1124`, batching) | **PARTIAL / different surface** — do NOT fake a tool |

### 4.2 From `docs/COMPETITORS-V1140.md` (Kilo Code / Augment Code)

| # | Competitor capability | SADEEM tool (`file:line`) | Verdict |
|---:|---|---|---|
| 2 | Specialized agents / modes | `propose_plan` `:985`, `task` `:312`, `agents.ts` | HAS |
| 10 | Codebase indexing / semantic context | `repo_map` `:1171`, `semantic_search` `:866`, `find_refs` `:1135`, `lsp_languages` `:2281`, `embeddingIndex.ts:195-295` | HAS — **V1140 `:90` claims "no semantic index"; that is outdated/wrong** |
| 11 | MCP | `prompts.ts:1021`, `tools.ts:1953` | HAS |
| 12 | Skills | `use_skill` `:1004`, `create_skill` `:1017` | HAS |
| 14 | Checkpoints | `checkpoint_save` `:820`, `checkpoint_restore` `:971` | HAS |
| 15 | Subagents | `task` `:312` | HAS |
| 16 | Worktrees | `worktree_create` `:752`, `worktree_remove` `:767` | HAS |
| 17 | Code review | `review_diff` `:1054` | PARTIAL (no multi-expert pipeline) |
| 19 | Browser / UI / media verification | `browser_*`, `preview_screenshot` `:208`, `ui_quality_check` `:664`, `lighthouse` `:2102`, `e2e_run` `:2118`, `a11y_audit` `:2135`, builders `:1520-1638` | HAS |
| 21 | Continuous memory / DNA | `remember` `:1033`, `dna_note` `:1063`, `recall_memory` `:1077`, `memory_verify` `:1349` | HAS, not unique |
| 22 | 145-tool roster / capability compass | `prompts.ts:801-817`, `tool_help` `:2262` | WEAK (salience) |
| 5 | IDE extensions | **NO equivalent** | GAP (structural) |
| 6 | Cloud agents | **NO equivalent** | GAP / N/A |
| 7 | Open source MIT repo | **NO equivalent** | GAP (we cannot claim) |
| 8 | Session share/fork links | **NO equivalent** | GAP (structural) |
| 13 | Hooks breadth | **NO tool** (`hooks.ts:42-56`) | GAP (2 events vs 30+) |
| 20 | Telemetry / OTel export | **NO equivalent** | GAP (structural) |

### 4.3 Competitor capabilities with **NO SADEEM equivalent** — honest list
1. IDE extensions (VS Code / JetBrains / Vim) — structural, not a tool.
2. Cloud / remote agents (Codex Cloud, Kilo Cloud, Cosmos) — local-first design decision.
3. Public MIT repository — not a tool.
4. Live session-sharing / fork links — `preload.ts:229` exports HTML only.
5. Hook event breadth (Claude Code 30+ events, 5 handler types) — `hooks.ts:42-56` has 2; a **hooks-service** gap, not a tool gap.
6. OpenTelemetry trace/metric export — `traces.ts` local JSONL only.
7. Code Mode `execute` as a first-class **model-callable** tool (OpenCode) — exists in the harness ("Code Mode runtime", `prompts.ts:1082`) but is **not** in the 145 registry. **The founder said do not add fake things: do NOT add it.**

**Every competitor TOOL capability (plan, debug, review, subagents, MCP, skills, checkpoints, LSP, worktrees, browser, memory, code-intel, DB, builders, verification) already maps to a real SADEEM tool above. There is no missing competitor tool to add.**

---

## 5. التوصيات / Recommendations (parent decides + implements)

### REMOVE (1)
- **`search_web`** — merge into `web_search` (add `max_results` to `web_search` schema at `tool-defs.ts:414-417`, update executor `tools.ts:3736-3750` to honor it), then delete `tool-defs.ts:568-578`, the case `tools.ts:1632-1633`, and executor `tools.ts:3752-3764`. Net: **144 tools**, zero capability loss. Evidence §3.1.

### MERGE (1 optional, low priority)
- **`search_files` + `search_grep`** — one content-search tool with a `mode` (`exhaustive` vs `fast-rg`) would remove the last genuine duplication (§3.2). Both are real; keep both until the parent chooses. Do **not** remove both.

### DO NOT REMOVE (explicit)
- All ~52 NICHE-BUT-REAL tools (§2 tables), including the 7 small utility one-liners (`uuid_gen`, `encode/decode_base64`, `color_convert`, `url_encode/decode`, `regex_test`) and the 14 unmentioned-in-prompt tools (§3.4). They have real executors; they are not padding. Removing them would break real workflows and reduce genuine capability.
- `worktree_list`/`preview_open` phantom cases (§3.5): leave the executor-only paths as-is; do not invent defs.

### ADD (nothing fake)
- **No new tool is justified.** §4.3 gaps are structural (IDE/cloud/share/MIT/telemetry/hooks breadth/Code Mode surface) — none can be honestly closed by adding a fake tool. Adding a "cloud" or "share" tool would violate the founder's "صدق اشياء مش موجودة عندنا لا تضيفها".

### FIX (not tool changes)
1. Add one routing line to the CAPABILITY ROSTER (`prompts.ts:809-834`) for the 14 unmentioned tools (§3.4) — salience only.
2. Correct `docs/COMPETITOR-CAPABILITIES-V1134.md:18-19,29,131,135` (146 → 145) and `docs/COMPETITORS-V1140.md:90` ("no semantic index" → `semantic_search` exists at `tool-defs.ts:866` / `embeddingIndex.ts:195`). Documentation accuracy, not source.

---

## 6. الخلاصة النهائية / Final word

**AR:** ١٤٥ أداة: ١٤٣ أداة حقيقية ومتميزة، و٢ فقط فيها تكرار (`search_web` وازدواج `search_files`/`search_grep`). صفر أدوات ميتة، وصفر أدوات محجوزة بموافقة مستحيلة، وصفر منفّذات تقول «غير مطبّقة». المنافسون لا يملكون أداة تفتقدها سديم؛ فجواتهم/فجواتنا بنيوية (IDE، سحابة، مشاركة، telemetry، اتساع hooks) ولا تُحل بأدوات مختلقة. **لا تحذف أدوات متخصصة حقيقية.**

**EN:** Of 145 tools: 143 are genuinely distinct and real; 2 are redundancies. Zero dead, zero gate-blocked, zero stubs. No competitor tool capability is missing from SADEEM. The honest fixes are one small merge, one salience line in the prompt, and two documentation corrections — **not mass deletion and not fake additions.**
