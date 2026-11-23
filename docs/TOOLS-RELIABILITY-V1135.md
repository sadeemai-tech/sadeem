# CORE TOOL RELIABILITY — SADEEM v11.35
# موثوقية الأدوات الأساسية — سديم v11.35

> **Founder / المؤسس:** «كل ما يجي يعمل أمر أو يفعل إشي يطلع له ايرور ايرور ايرور…
> مشاكل مزعجة… استخدم الهندسة العكسية اللي قمت فيها بتحسين التطبيق الإلكتروني.»
>
> **Owned file:** `electron/agent/tools.ts` (executor error-handling paths ONLY).
> Tool definitions (`tool-defs.ts`), engine, prompts, store, editEngine,
> gitService and memoryContinuity were **NOT** edited — only consumed.
> **الملف المملوك:** `electron/agent/tools.ts` (مسارات معالجة أخطاء المنفّذين فقط).
> لم أعدّل تعريفات الأدوات ولا المحرك ولا البرومت ولا المتجر ولا المحرّر ولا خدمات
> git/الذاكرة — استهلكتُها فقط.

---

## 0. The blunt verdict / الحكم الصريح

**EN:** The "error error error" cascade was **not** a missing feature. The app
already had 145 reachable tools with many `Fix:` hints. The real friction was
three concrete defects in the *executor return shape*: (1) raw Node
`Error: ENOENT…` strings were pasted verbatim into `tool_result`, (2) a no-match
`edit_file` never said what text actually exists, so a weak model retried with a
new guess forever, and (3) invisible Unicode marks / canonical-form differences
turned valid Arabic filenames into ENOENT chases. All three are fixed with
**return-shape helpers only** — no tool definition, no engine semantics, no
approval gate changed.

**AR:** «سلسلة الأخطاء» لم تكن ميزة ناقصة. التطبيق كان يحتوي أصلًا على ١٤٥ أداة
قابلة للاستدعاء وكثير من تلميحات `Fix:`. الاحتكاك الحقيقي كان ثلاثة عيوب في
**شكل قيمة الإرجاع للمنفّذ**: (١) نصوص `Error: ENOENT…` الخام من Node كانت تُلصق
حرفيًا في نتيجة الأداة، (٢) فشل `edit_file` في المطابقة لم يقل أي نص موجود فعلًا،
فالنموذج الضعيف يعيد المحاولة بتخمين جديد إلى الأبد، (٣) علامات يونيكود غير مرئية
واختلاف الشكل المعياري (NFC/NFD) تحوّل اسم ملف عربي صحيح إلى مطاردة ENOENT.
أُصلحت الثلاثة بـ**مساعدات شكل إرجاع فقط** — بلا تغيير تعريف أداة أو دلالة محرك
أو بوابة موافقة.

---

## 1. Shared failure helpers / مساعدات الفشل المشتركة

| Helper | File:line | Job |
|---|---|---|
| `normalizeFsPath` | `electron/agent/tools.ts:417` | Strip ZWSP/ZWNJ/ZWJ/LRM/RLM/bidi controls/BOM, NFC-normalize a model-emitted path. |
| `coreFail` | `electron/agent/tools.ts:424` | One line, one language: `<tool>: <WHAT>. Fix: <exact next step>.` |
| `errLine` | `electron/agent/tools.ts:431` | First line of a thrown error, no `Error:` prefix, no stack frames, ≤240 chars. |
| `fsFault` | `electron/agent/tools.ts:435` | Map `ENOENT/EISDIR/ENOTDIR/EACCES/EPERM/ENOSPC/EROFS/EBUSY/EMFILE/…` to a distinct cause + exact fix. |
| `lineSimilarity` / `closestLineHint` | `electron/agent/tools.ts:492`, `:516` | Bounded Levenshtein, returns the closest REAL lines with 1-based numbers. |
| `explainToolCrash` | `electron/agent/tools.ts:618` | Last-resort guard: no stack, distinct wrong-shape path for `TypeError`/`RangeError`. |
| `resolveInWorkspace` | `electron/agent/tools.ts:993` | Every path resolver now routes through Unicode normalization. |
| `expandTilde` | `electron/agent/tools.ts:1232` | Same hygiene for `~/…`. |

Every failed core tool now has the **same honest envelope** but a **different
diagnosis and a different fix** — never the generic word "failed" twice.

---

## 2. Before / After — the real error examples

### 2.1 Missing file — `read_file` (`tools.ts:2031`)

**BEFORE** (raw Node error + generic advice):
```
Cannot read D:\ws\main.txt: Error: ENOENT: no such file or directory, open 'D:\ws\main.txt'
Path resolution: "main.txt" is relative — resolved against workspace "D:\ws" to "D:\ws\main.txt".
Fix: verify the exact path with list_dir / glob_files (or create the file), and check read permissions.
```

**AFTER** (one line, distinct cause, exact next step):
```
read_file: path does not exist: D:\ws\main.txt (ENOENT). Fix: check the exact name with list_dir or glob_files, create the file if it is meant to exist, then retry.
Path resolution: "main.txt" is relative — resolved against workspace "D:\ws" to "D:\ws\main.txt".
```
`fsFault` (`tools.ts:435`) also gives distinct messages for *directory-as-file*
(`EISDIR`), *permission denied* (`EACCES`), *disk full* (`ENOSPC`), *locked file*
(`EBUSY`) and *read-only filesystem* (`EROFS`).

### 2.2 Wrong argument type — `write_file` / `edit_file` / `run_command` / `search_files`

**BEFORE:** `String(12345)` silently created a file literally named `12345`, or
`String(object)` wrote `[object Object]` and reported success.

**AFTER** (`tools.ts:2445`, `:2518`, `:2777`, `:3008`, plus the dispatch guard at
`tools.ts:572`):
```
Invalid arguments for write_file: "path" must be a JSON string (received number). Re-emit with "path": "…" — numbers, arrays and objects are not accepted.
```
No file named `12345` is created (asserted by the new test).

### 2.3 Bad JSON arguments — dispatch (`tools.ts:608`)

**BEFORE:** a truncated or comment-laden call sometimes bubbled a parse stack.

**AFTER** (`invalidArgsMessage`, unchanged wording preserved for compatibility):
```
Invalid JSON arguments for read_file: expected a JSON object. Received: {path: "a.ts",}. Fix: re-emit the tool call with strict JSON — double-quoted keys/strings, escaped newlines (\n), no trailing commas and no comments.
```

### 2.4 No-match edit — the retry-loop killer (`tools.ts:2568`, `:4609`)

**BEFORE:**
```
edit_file failed: old_string not found (even with whitespace/fuzzy tolerance). Re-read the file and copy old_string EXACTLY from the current content — do not paraphrase code.
```
The model received no candidate text → guessed again → same error → loop.

**AFTER** (line numbers + copyable exact text):
```
edit_file: old_string not found in D:\ws\edit.txt Closest line in the current file: line 3: "const answer = 42;". Fix: re-read D:\ws\edit.txt with read_file and copy old_string EXACTLY from the current content (include unique surrounding lines if needed), then retry once.
```
`multi_edit` does the same against the **rolling buffer** (`:4609`), so it points at
the text *after earlier edits in the same call* and states `nothing was saved`.
`multi_file_edit` inherits the same hint (`:7729`). The suggestion is bounded:
files > 5000 lines and lines > 400 chars are skipped; no fuzzy re-write is applied.

### 2.5 Unicode / Arabic paths

**BEFORE:** a path with an invisible ZWNJ or a decomposed `café` produced
`ENOENT` on a file that visibly existed.

**AFTER** (`normalizeFsPath:417` + `resolveInWorkspace:993`):
- `café.txt` in NFD resolves to the on-disk NFC file.
- `olution\u200Bتقرير\u200C.txt\uFEFF` (ZWSP + ZWNJ + BOM around an Arabic name)
  resolves to `تقرير.txt`; Arabic content is returned intact, no U+FFFD garbling.

### 2.6 Search root typo — `search_files` (`tools.ts:3031`, `:3034`)

**BEFORE:** `search_files {pattern:"x", path:"no-such-dir"}` → `ok:true` with
`No matches.` — the model searched the same wrong folder again.

**AFTER:**
```
search_files: path does not exist: D:\ws\no-such-dir (ENOENT). Fix: check the exact name with list_dir or glob_files, create the file if it is meant to exist, then retry; omit "path" to search the whole workspace.
```
Passing a file instead of a directory now yields `search path is a file, not a
directory: … Fix: pass a directory in "path", or use read_file for that file.`

### 2.7 Failed tool does not abort the turn

`executeTool` already caught throws; this release keeps that contract and
additionally guarantees all five failure classes above are **pairwise distinct**,
all carry a next step, all are single-language, and a valid call immediately after
a failed one still returns `ok:true` (new test 8). The engine owns continuation;
we only own the return shape.

---

## 3. Memory continuity wiring (C7) — additive, best-effort

| Change | File:line |
|---|---|
| Import `writeContinuityFact`, `recallContinuity`, `forgetContinuity` | `electron/agent/tools.ts:26-31` |
| `mirrorRememberFact` — kind mapping, provenance `remember`, honest failure note | `electron/agent/tools.ts:3345` |
| `mirrorForgetFact` — a forgotten fact stops resurfacing | `electron/agent/tools.ts:3379` |
| User/DNA branch mirrors after `recordAgentNote` | `electron/agent/tools.ts:3438` |
| Project branch mirrors after `MEMORY.md` write | `electron/agent/tools.ts:3487` |
| `forget` branch removes from continuity | `electron/agent/tools.ts:3421` |
| `recallMemoryTool` appends `recallContinuity` hits for both scopes | `electron/agent/tools.ts:3526`, `:3531` |

The primary write is **never** changed: it keeps its original output and `ok`
value. A continuity failure only appends one short honest line, e.g.
`[continuity mirror skipped: disk write failed — the primary memory write still succeeded.]`
The mirror is wrapped in `try/catch` at every call site — it cannot throw into
the tool result or abort the turn.

---

## 4. Worktree tools now use the hardened service (A3)

| Change | File:line |
|---|---|
| `worktreePaths` is now a thin view over `gitSvc.worktreePath` (no duplicated path math) | `electron/agent/tools.ts:6914` |
| `worktreeToolFailure` — one actionable English error per service throw | `electron/agent/tools.ts:6922` |
| `worktreeListTool` — read-only view over `gitSvc.listWorktrees` | `electron/agent/tools.ts:6932`, dispatch `:1681` |
| `worktreeCreate` — preflight via `listWorktrees`, then `gitSvc.createWorktree` | `electron/agent/tools.ts:6946`, `:6956`, `:6977` |
| `worktreeRemove` — `gitSvc.removeWorktree` (path jail, dirty guard, stale pruning) | `electron/agent/tools.ts:6991`, `:7013` |

The duplicated `gitRunIn(['worktree', …])` / hand-rolled `fs.stat` / locale-
dependent stderr parsing is gone. The approval card, `denyHint` posture and the
`Worktree created:` / `Worktree removed:` output shape are unchanged. Service
errors such as `WORKTREE_DIRTY`, `WORKTREE_EXISTS`, `WORKTREE_BASE_MISSING`,
`INVALID_NAME` and `UNSAFE_PATH` now reach the model verbatim with a fix.

**Honest note:** there is still **no registered `worktree_list` tool definition**
in `tool-defs.ts` (owned by another agent). The executor is present and ready at
`tools.ts:1681`, but `executeTool` only dispatches named defs, so the def must be
added by its owner before the model can call it. `listWorktrees` is already used
internally by create/remove preflight and by `removeWorktree`.

---

## 5. Verification / التحقق

| Check | Result |
|---|---|
| `npx tsc -p tsconfig.node.json --noEmit` | **PASS** (no errors) |
| `tests/v1135-tools-reliability.test.mjs` (new; local fixtures, no network) | **9/9 PASS** |
| `tests/v1126-all-tools.test.mjs` | **4/4 PASS** — 145 defs, sweep `ok=98 denied=47`, 0 crash |
| `tests/v1131-tools.test.mjs` | **8/8 PASS** — 145-call sweep, 0 raw JSON |
| `tests/v1134-all-tools.test.mjs` | **6/6 PASS** — 145 dispatch, 0 threw |
| `tests/v1135-memory-continuity.test.mjs` | **7/7 PASS** |
| `tests/v1131-learning.test.mjs` | **13/13 PASS** |
| `tests/v1135-worktree.test.mjs` | **6/6 PASS** |
| `tests/v1131-git.test.mjs` | **12/12 PASS** |

The new test is fully local: it bundles the app's own `tools.ts` with esbuild,
uses a minimal Electron stub and temp fixtures, and never touches the network.
It asserts: missing file · wrong type · bad JSON · no-match `edit_file` ·
no-match `multi_edit` · Unicode/Arabic paths · search-root validation · distinct
non-throwing failures + turn continuation.

---

## 6. Honest limitations / حدود صادقة

- `editEngine.tolerantReplace`'s **fuzzy stage** (owned by another agent) will
  silently apply a near-miss `old_string` to a similar line — that is *its*
  behavior, not changed here. Our no-match fix applies only when that stage truly
  finds nothing; the new tests use genuinely absent strings.
- The closest-line hint is a **suggestion**, not an auto-edit: the model still
  has to copy the exact text. That is deliberate — an auto-edit could write the
  wrong line.
- `worktree_list` has an executor but no tool definition yet (see §4).
- Prompt-level salience is still the other half of the problem: the v11.34
  `CAPABILITY ROSTER` (owned by the prompts agent) is what makes a weak model
  choose the right tool in the first place. This release makes the *failure*
  recoverable; it cannot make a weak model reason better.
