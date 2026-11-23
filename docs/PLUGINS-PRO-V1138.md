# PLUGINS PRO — v11.38 / تقرير الإضافات الاحترافية

**Verdict (EN): the plugin system was cosmetically alive and functionally broken. It is now real.**
**الحكم (AR): نظام الإضافات كان حيّاً شكلياً ومعطلاً فعلياً. أصبح يعمل فعلاً.**

Founder: «البلوجينز ثم البلوجينز يجب ان تعمل. البلوجينز يجب ان يكون بلوجينز احترافي».

---

## 1 · WHAT WAS BROKEN / ما كان معطلاً

| # | Defect (EN) | العطل (AR) | Evidence |
|---|---|---|---|
| 1 | Plugin prompts were written as `plugin__<id>__<name>.md`. These filenames contain **dots**, but `slashService` only scans `/^[a-z0-9][a-z0-9_-]*\.md$/`. Result: `/research` from the Web Pack starter **never existed** in the slash menu or dispatcher. Old tests only checked that a file existed — not that it was visible. | كانت أوامر الإضافات تُكتب بأسماء تحتوي نقاطاً، بينما الماسح يقبل أسماء بسيطة فقط؛ لذلك `/research` لم يكن موجوداً فعلاً. | `electron/services/slashService.ts:18` (NAME_RE) vs old `pluginService.ts:230` |
| 2 | `enabledPluginPrompts()` was exported but **consumed by nobody** — dead API. | الدالة كانت ميتة لا يستخدمها أحد. | repo-wide grep |
| 3 | Disable removed the MCP server (manifest read live) but **left the prompt command files on disk** — a disabled plugin's slash commands kept working. | التعطيل كان يزيل خادم MCP فقط ويترك أوامر الشرطة فعّالة. | old `setPluginEnabled()` never touched command files |
| 4 | `setPluginEnabled(id, …)` used the raw id as a **path segment** with no regex jail — `../../x` could escape `userData/plugins`. | كان معرّف الإضافة يُستخدم كمسار دون تحقق — ثغرة تجاوز مسار. | old `pluginService.ts:344-350` |
| 5 | Install swallowed skill-copy and prompt-write failures with `.catch(() => undefined)`, reporting success while contributions were missing (silent failure). | كان التثبيت يبتلع الأخطاء ويُبلغ عن نجاح كاذب. | old `pluginService.ts:213-214, 232` |
| 6 | Non-atomic manifest writes: a crash mid-write could corrupt a plugin permanently. | الكتابة غير ذرية وقد تفسد الإضافة عند انقطاع الكهرباء. | old direct `writeFile` |
| 7 | Starter Git Rituals shipped prompt `/changelog`, which is a **builtin renderer command** (`modes.ts`) — it would be shadowed and silently dead. | حزمة Git كانت تستخدم `/changelog` وهو أمر مدمج في الواجهة. | `src/lib/modes.ts:163` |
| 8 | No validation of MCP transport/args/env/URL, prompt name/count/size, reserved names, or duplicates. | لا تحقق من محتوى الملف إلا بالحد الأدنى. | old `validateManifest()` |
| 9 | There is **no** `src/components/panels/PluginsPanel.tsx`; the real UI is `src/components/settings/PluginsSection.tsx` (found and edited). | لا توجد لوحة بالإسم المذكور؛ الواجهة الحقيقية في الإعدادات. | filesystem |

---

## 2 · WHAT WAS FIXED / ما أُصلح

Owner files actually modified:
- `electron/services/pluginService.ts`
- `src/components/settings/PluginsSection.tsx`
- `tests/v1138-plugins.test.mjs` (new)
- `docs/PLUGINS-PRO-V1138.md` (this file)
- `electron/ipc.ts` plugin handlers: **no change needed** — IPC channels self-register from `pluginService.ts`; the only plugin line in `ipc.ts` is the side-effect import.

Fixes:
1. **Real slash commands.** `syncPluginCommands()` publishes each enabled prompt as `<slug>.md` (valid `NAME_RE`), so `slashService` lists it, `dispatchSlashCommand()` expands `$ARGUMENTS`, and the Composer menu sees it. The legacy `plugin__<id>__<name>.md` marker is still written for backward compatibility, but it is no longer the functional path.
2. **Enable/disable is a transaction.** `setPluginEnabled()` writes the manifest atomically then reconciles command files in the same step; on failure it rolls the flag back. MCP servers are read from manifests at every run, so they appear/disappear instantly.
3. **Persistent ownership.** `<userData>/plugins/.command-owners.json` maps command file → plugin id. Disable/uninstall deletes **only our own** files; a user's `research.md` is never overwritten (recorded as a conflict instead). Deterministic conflict resolution: lowest plugin id wins.
4. **Path jail everywhere.** `assertPluginId()` validates every id used as a path segment (setEnabled, uninstall, reveal, manifest reads). Manifest `id` must match its directory.
5. **Honest install.** Full manifest validation (id, name, version, size caps, MCP transport/args/env/URL, prompt slug/reserved/duplicate/body caps) with precise `PLUGIN_*` errors; failure rolls back the install; skills-copy failure is reported, not swallowed.
6. **Atomic writes** (temp + rename; Windows overwrite handled) for manifests, owners and command files.
7. **Starters repaired.** `/changelog` → `/git-changelog`; `/research` now includes `$ARGUMENTS`; starters advertise true contribution counts/names over IPC.
8. **UI shows real effects.** Active-contributions counter (MCP + slash), per-plugin contribution badges, ACTIVE/OFF state, install toasts naming what became active, refresh, honest raw error toasts, and disabled toggles while busy.
9. **URL/file install unchanged in security posture**: https-only, private/loopback host refusal, redirect re-check, 2MB cap, path jail + symlink check.

---

## 3 · VERIFICATION / التحقق

| Command | Result |
|---|---|
| `npx tsc -p tsconfig.node.json --noEmit` | ✅ pass |
| `npx tsc --noEmit` | ✅ pass (the earlier FlowsPanel / PreviewArea errors were fixed by other waves during this audit) |
| `node --test --test-force-exit tests/v1138-plugins.test.mjs` | ✅ **10/10 pass** (install → MCP+prompt+live slash → disable → restart → uninstall; validation, jail, URL, IPC) |
| `node --test --test-force-exit tests/v1131-registry.test.mjs` | ✅ 9/9 pass (no plugin regressions) |
| `node --test --test-force-exit tests/v102-core.test.mjs` | ✅ plugin section pass after preserving legacy error precedence |
| `node --test --test-force-exit tests/v1131-full-smoke.test.mjs` | ⚠️ **81/82** — all **60/60 screens render OK** (including `PluginsSection`), 709 controls scanned / 0 dead, 0 unstable selectors, all 6 engine shapes pass. The only failure is a **test regex false positive** from a comment in `src/components/panels/registry.tsx:24` — see Handoff 1. No plugin failure. |

---

## 4 · HANDOFFS — ملفات الآخرين / files I must not touch

1. **`src/components/panels/registry.tsx:22-25` (only remaining full-smoke blocker, not plugin code).** A v11.38 comment literally contains `panelOf(XMod, 'Name')`; the coverage guard regex `/panelOf\((\w+)Mod,\s*'(\w+)'\)/g` in `tests/v1131-full-smoke.test.mjs:798` mistakes it for a real panel and demands a screen named "Name". Fix by rewording the comment (owner: Signature-rail wave) or by stripping comments before scanning in the test (owner: smoke-test wave). Everything else in that suite is green: 60/60 screens, 6/6 engine shapes, 0 dead controls.
2. **Resolved during the audit (no action needed):** the earlier `PreviewArea.tsx` `focusPreview` TDZ crash and the `FlowsPanel.tsx` / `FlowsBridge` `flowsValidateByReplay` type errors were fixed by their owning waves; both `tsc` commands now pass.
3. **`electron/agent/register.ts` / `electron/agent/prompts.ts` (optional enhancement, not a blocker).** MCP injection already calls `enabledPluginMcpServers()` (`register.ts:655-663`) and works. Plugin prompts are fully functional through real slash files. If the founder also wants plugin prompts injected as named prompt templates in the system prompt, wire `enabledPluginPrompts()` there — the API is now the single source of truth.
4. **`src/lib/modes.ts` reserved names.** `pluginService.ts` keeps a local `RESERVED_COMMANDS` set mirroring `SLASH_COMMANDS` (it cannot import a renderer module). Whoever edits `modes.ts` builtins must add new names to that set as well.
5. **`src/lib/api.ts` / preload starter type** is narrower than the new runtime `kdx:plugins:starters` payload (extra `mcpCount`, `promptCount`, `mcpNames`, `promptNames`). UI casts locally; a type widening would remove the cast. No functional impact.
6. **File-name correction (F10).** There is no `PluginsPanel.tsx`; all UI work landed in `src/components/settings/PluginsSection.tsx`.
