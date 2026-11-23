# v11.38 — SOURCE CONTROL & FILES — blunt verdict / الحكم الصريح

## EN — verdict

**SOURCE CONTROL works. FILES work. Both are real, not decorative.**

- GitPanel now reads **real** git status (branch, staged / unstaged / untracked,
  ahead/behind, log) and every control calls a **real** bridge into
  `electron/services/gitService.ts` → the actual `git` CLI.
- Stage / unstage / stage-all / commit / **branch create** / **branch switch**
  all execute against a real repository and report the real hash/ref.
- Honest blocking states are surfaced instead of being faked or hidden:
  **merge conflict** (`U`, commit + checkout refuse with a reason),
  **detached HEAD** (banner + pill), **missing git identity** (stated plainly;
  the service still auto-repairs so the first commit is not lost — that is a
  fix, not a lie).
- Destructive-ish branch switches confirm first when the tree is dirty.
- The files surface browses the **real** workspace tree through
  `fsService.readDirTree` and does read / edit / save / create / delete through
  real handlers. No phantom rows. Arabic/unicode filenames round-trip.
  Path jail refuses traversal, outside-root, relative and UNC access.

## AR — الحكم

**التحكم بالمصادر يعمل. الملفات تعمل. كلاهما حقيقي وليس للعرض فقط.**

- لوحة Git تقرأ حالة git حقيقية (الفرع، المُرحّل/غير المُرحّل/غير المتتبّع،
  السجل) وكل زر يستدعي جسراً حقيقياً إلى `gitService` ثم أمر `git` الفعلي.
- الإيداع، الترحيل، **إنشاء فرع**، **التبديل بين الفروع** تُنفَّذ على مستودع
  حقيقي وتُظهر الهash/المرجع الحقيقي.
- الحالات المانعة تُعرض بصدق: **تعارض الدمج** (يمنع الإيداع والتبديل برسالة
  واضحة)، **HEAD منفصل** (شريط تنبيه)، **غياب هوية git** (يُذكر صراحة مع
  إصلاح تلقائي حتى لا يُفقد الإيداع الأول).
- تبديل الفرع مع تغييرات غير محفوظة يطلب تأكيداً.
- لوحة الملفات تتصفح شجرة مساحة العمل الحقيقية وتقرأ/تحرر/تحفظ/تنشئ/تحذف
  بمعالجات حقيقية؛ لا صفوف وهمية؛ أسماء عربية/Unicode تعمل؛ قفص المسار يرفض
  التجاوز والوصول خارج الجذر والمسارات النسبية وUNC.

---

## What I actually changed / ما تغيّر فعلياً

| File | Change |
|------|--------|
| `src/components/panels/GitPanel.tsx` | Real branch section (list / create / create-and-switch / switch with confirm), conflict banner with click-to-open, detached-HEAD + identity banners, honest error notifications, conflict-aware commit disable, exported `isConflictStatus`. All controls wired. |
| `electron/services/gitService.ts` | `listBranches`, `createBranch` (safeRef + verified start point), `identityInfo`, `isConflictStatus`; honest conflict codes in `status()`; explicit conflict/identity/dirty errors in `commit()` and `checkout()`. |
| `src/lib/api.ts`, `electron/preload.ts`, `electron/ipc.ts` | **Minimal bridge wiring** (`gitBranchList` / `gitBranchCreate` / `gitIdentity`, channels `kdx:git:branch:list|create`, `kdx:git:identity`) — required for the panel to reach gitService. Coordinated here, see handoffs. |
| `tests/v1138-git-files.test.mjs` | 6 real tests: temp git repos + temp files, no git mocks. |
| `docs/GIT-FILES-V1138.md` | This file. |

## Verification / التحقق

- `npx tsc --noEmit` — **GREEN** (web).
- `npx tsc -p tsconfig.node.json --noEmit` — **GREEN** (node).
- `tests/v1138-git-files.test.mjs` — **6/6 GREEN** (~56s).
- `tests/v1135-worktree.test.mjs` — **6/6 GREEN**.
- `tests/v1131-git.test.mjs` — **12/12 GREEN**.
- `tests/v1131-full-smoke.test.mjs` — **82/82 GREEN** (GitPanel SSR OK, registry
  coverage OK, dead controls **0 / 715 scanned**). It was transiently red in
  `ENGINE SHAPE 1/4–3/4` while another wave was mid-edit on `engine.ts`
  (extra `heartbeat` events); that wave resolved it. I did **not** edit
  `engine.ts`.

## Handoffs / تسليمات (important)

1. **Files panel location** — there is **no** `src/components/FilesPanel.tsx`.
   The real files panel is `src/components/ProjectFiles.tsx` →
   `src/components/FileTree.tsx`, hosted by `src/components/panels/WorkspacePanel.tsx`.
   There is no `workspaceService.ts` either; the backend is
   `electron/services/fsService.ts` (path jail + real I/O). I did **not** edit
   those files (outside my ownership); I verified them through the real test.

2. **store.ts (owned by another wave)** — `saveTab()` calls `api.writeFile`
   with **no try/catch**, so a failed write surfaces as an unhandled rejection
   rather than an honest toast. `createEntry`/`deleteEntry`/`renameEntry`/
   `openFile` notify only a generic localized message. Please attach the real
   error text and close/refresh the affected tab there.

3. **api.ts / preload.ts / ipc.ts (shared infra, minimal touch)** — I added only
   the three git bridge methods needed for branch create/list + identity.
   If another wave is editing these files, merge the `v11.38` lines (search
   `gitBranchCreate` / `kdx:git:branch:create`). No existing contract changed.

4. **Transient concurrent interference (resolved)** — during verification,
   another wave's in-flight `engine.ts` edit briefly broke `ENGINE SHAPE 1/4–3/4`
   (extra `heartbeat` events) and a `registry.tsx` comment briefly broke
   `COVERAGE`. Both waves fixed their own files; the final full-smoke run is
   **82/82 green**. Neither was git/files-related and I did not edit those
   owned files.

5. **i18n** — new `t('git.*', …)` keys use English fallbacks. Add Arabic strings
   in the i18n file owned by another wave (fallbacks are safe until then).

6. **Scope boundaries (honest)** — branch refs are ASCII-only by git's own ref
   grammar (Arabic **filenames** are fully supported); there is no revert/reset/
   stash UI (out of scope); conflict resolution happens in the editor by fixing
   markers then staging — the panel never pretends to auto-resolve.

## Proof commands

```
node --test --test-force-exit tests/v1138-git-files.test.mjs
node --test --test-force-exit tests/v1135-worktree.test.mjs
node --test --test-force-exit tests/v1131-git.test.mjs
node --test --test-force-exit tests/v1131-full-smoke.test.mjs   # engine tail — other wave
npx tsc --noEmit && npx tsc -p tsconfig.node.json --noEmit
```
