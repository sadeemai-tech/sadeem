# WORKTREE — V11.35 HARDENING / تقوية الورك تري

**Date:** 2026-11-21 · **Owner:** worktree subagent · **Scope:** `electron/services/gitService.ts` + new test + this doc.

---

## الحكم الصريح (Blunt verdict — العربية)

طبقة الورك تري في `gitService.ts` **الآن تعمل فعليًا وبقوة**: تتحقق من الـ base ref قبل الإنشاء، وتتعامل مع DETACHED HEAD بدون فقدان الكوميت، وترفض المسارات الخطرة (خارج مساحة العمل / المسارات النسبية المتسربة)، وتمنع الحذف إذا كان الورك تري متسخًا إلا بـ `force=true`، وتنسخ `.worktreeinclude` بأمان مع تصحيح separators على ويندوز، وتُنظّف التسجيلات الميتة بدل أن تعلق. كل فشل يرجع برسالة إنجليزية واحدة واضحة فيها الخطوة التالية. الاختبار الحقيقي يثبت ذلك على git حقيقي (6/6 ناجح).

**لكن بصراحة:** أداة الوكيل `worktree_create`/`worktree_remove` في `electron/agent/tools.ts:6608-6719` **لا تستدعي `gitService.ts` أبدًا** — فيها نسخة مكررة خاصة بها (`gitRunIn` / `worktreePaths`). بمعنى أن تحسيناتي على الـ service لا تصل إلى مسار الوكيل بعد. هذا خارج نطاقي (ملف tools.ts مملوك لوكيل آخر) وأُبلّغ عنه للوالد. **الورك تري "احترافي وقوي" فعليًا في طبقة الـ service، لكن التوحيد النهائي لازم.**

**وكذلك:**Founder قال «الوكلاء ما عنده حد معين»، ومع ذلك يوجد سقف صلب **4 subagents خلفية لكل جلسة** (انظر التفاصيل أدناه). هذا يتعارض مع توجيهك ويحتاج قرار من الوالد.

---

## Blunt verdict (English)

The `gitService.ts` worktree layer is **now genuinely robust and production-grade**: verified base ref, detached-HEAD-safe creation, path jail, dirty-delete guard, safe `.worktreeinclude` copy with Windows-correct relative paths, stale-entry pruning, and single-language actionable errors. The real-git E2E test proves it (6/6 green).

**But honestly:** the agent-facing `worktree_create`/`worktree_remove` tools in `electron/agent/tools.ts:6608-6719` **never call `gitService.ts`** — they carry a duplicate implementation. My hardening does not reach the agent path until that file is unified by its owner (reported to parent, out of my scope). Service layer = strong; agent layer = still divergent.

**Also:** the founder said "الوكلاء ما عنده حد معين" (no hard limit on subagents), yet a hard background-subagent cap of **4 per session** exists (details below). That contradicts the directive and needs a parent decision.

---

## What changed — gitService.ts (exact file:line)

| # | Fix | Location |
|---|---|---|
| 1 | Worktree `list --porcelain` path unquoting + native normalization (Windows forward-slash paths) | `electron/services/gitService.ts:375-379`, `:360` |
| 2 | `resolveWorktreeBase()` — verifies `rev-parse --verify <ref>^{commit}`; `INVALID_BASE` for injection, `WORKTREE_BASE_MISSING` (with "commit first / pass base") for empty repo or bad ref; detached HEAD handled by branching explicitly from the verified commit | `electron/services/gitService.ts:425-447` |
| 3 | `createWorktree(root, name, base?)` — verifies base, refuses existing target directory, creates branch from explicit ref | `electron/services/gitService.ts:451-487` |
| 4 | `copyWorktreeInclude()` — backslash→`/` normalization, rejects NUL / POSIX+Windows absolute / drive-relative / `..` segments, containment re-check, no clobber | `electron/services/gitService.ts:492-522` |
| 5 | `copyDirFlat()` — per-entry containment guard, never follows symlinks | `electron/services/gitService.ts:560-569` |
| 6 | `assertWorktreeTarget()` — exported path jail: target must be the exact `parent/sadeem-<name>` sibling, never inside the workspace; `UNSAFE_PATH` + next step | `electron/services/gitService.ts:541-559` |
| 7 | `removeWorktree()` — path-jail check on registered path, **proactive locale-independent dirty check** (`WORKTREE_DIRTY` unless `force=true`), stale registration pruned via `worktree prune`, branch cleanup | `electron/services/gitService.ts:594-641` (dirty at `:612-616`, prune at `:635`) |

All new errors are English-only, carry a `TOKEN:` prefix and a next step — no raw git stderr dumps.

---

## Verification (actually run)

- `npx tsc -p tsconfig.node.json --noEmit` → **EXIT 0** (clean).
- `node --test tests/v1135-worktree.test.mjs` → **6/6 pass** (real temp git repos, no network):
  create→list→resolve→remove, base-ref verification (empty repo / bogus / injection), detached HEAD, path jail, dirty guard + stale prune, `.worktreeinclude` safe copy + Windows separators.
- `node --test tests/v1131-git.test.mjs` → **12/12 pass** (no regression).
- `node --test tests/v1126-all-tools.test.mjs` → **4/4 pass** (no regression).

New test: `tests/v1135-worktree.test.mjs`.

---

## Subagent-cap finding (read-only — NOT edited, out of scope)

**There IS a hard cap — but only on BACKGROUND subagents:**

- `electron/agent/engine.ts:759` — `const BACKGROUND_SUBAGENT_CAP = 4;`
- `electron/agent/engine.ts:6625` — enforcement in `runBackgroundSubagent()`: if in-flight count `>= 4`, it refuses and emits `SUMMARY 'BACKGROUND_LIMIT'`.
- `electron/agent/engine.ts:1331-1334` — `backgroundSubagentCount()` helper (callers can pre-check).
- `electron/agent/engine.ts:1210` — `backgroundRunning` map holding the per-session counter.

The **parallel batch** path has **no cap**: `electron/agent/subagentRunner.ts:585-597` launches all tasks (`runSubagentBatch`) via `Promise.allSettled`. The per-subagent **step** limit (`MAX_ITERATIONS = 12`, `subagentRunner.ts:50`) is a step bound, not an agent-count cap.

=> Founder's "no hard limit on subagents" is **violated for background subagents (4)**. Parent decision needed (`engine.ts` owned by another agent — I did not edit it).

---

## Needed changes reported to parent / tool-defs owner (A2)

- `electron/agent/tool-defs.ts:751-764` (`worktree_create`): description/params mention only `name`. If `base` is surfaced to the model, add an optional `base` string param and state that HEAD (incl. detached) is used when omitted. **Do not edit here — A2 owns this section.**
- `electron/agent/tool-defs.ts:766-780` (`worktree_remove`): already documents `force`; fine.
- **Critical (owner of `tools.ts`, not me):** `electron/agent/tools.ts:6608-6719` should delegate to `gitSvc.createWorktree/removeWorktree/listWorktrees` so the agent path inherits base verification, detached-HEAD safety, path jail, dirty guard and stale prune. Today it reimplements `git worktree add/remove` with its own `worktreePaths()` and only a naive `force` hint. Until unified, the agent-facing tool is **not** the hardened implementation proven by `tests/v1135-worktree.test.mjs`.
