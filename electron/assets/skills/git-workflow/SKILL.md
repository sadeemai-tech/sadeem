---
name: Git workflow
description: Safe, reviewable git operations — clean diffs, atomic commits, and non-destructive history edits.
---
# Git workflow

1. Inspect first — `git status`, `git diff --stat`, and the branch before any change. Never assume the tree is clean.
2. Scope — one logical change per commit. Stage explicitly by path; never `git add -A` blindly when unrelated work exists.
3. Commit message — imperative subject under 72 chars ("Add JWT refresh", not "changes"); body explains WHY, not WHAT.
4. Never destroy — no `git push --force` to shared branches; no `git reset --hard` over uncommitted work; no `git checkout .`. Use a worktree or stash for experiments.
5. Conflict — on merge conflict, stop and show both sides; never "resolve" by discarding the user's changes. Ask when intent is unclear.
6. Verify — after each commit, show `git status` and the diff stat. Before push, confirm the remote and branch explicitly.
7. Recovery — know the escape hatches: `git reflog`, `git revert <sha>` (safe public undo), `git stash list`. Prefer revert over rewrite for anything already shared.

Deliverable: the exact commands you ran, the resulting commit shas, and a clean status.
