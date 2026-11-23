# FINAL SECURITY AUDIT — SADEEM v11.12.0 (pre-launch)
# التدقيق الأمني النهائي — سادم 11.12.0 (قبل الإطلاق)

**Audit date / تاريخ التدقيق:** 2026-11-19
**Auditor / المدقق:** security subagent — **read-only on all application source**. Only this document was created / لم أعدّل أي ملف مصدر، أنشأت هذا المستند فقط.
**Scope / النطاق:** (1) verify all previously-fixed items are still correct; (2) hunt for NEW issues from the 19-agent wave. All findings carry `file:line` citations.
**Baseline / المرجع:** `docs/SECURITY-AUDIT-v1116.md` (same date) and `docs/LAUNCH-AUDIT.md`.
**Line-number caveat:** the wave was still editing UI files at 21:05–21:06 while this audit ran. Security-critical files were stable (see P1-4). Re-verify line numbers before applying fixes.

---

## VERDICT / الحكم

> ### ❌ NOT SAFE TO LAUNCH AS-IS. / لا تُطلق الآن.

**Arabic:** لا توجد ثغرة P0 قابلة للاستغلال عن بُعد (لا RCE، ولا تجاوز مصادقة، ولا تسريب مفتاح). لكن الإطلاق **موقوف** بأربع نقاط P1: (1) الملفات لا تزال غير موقّعة رقميًا — وهو خرق صريح لمطلب المؤسس "كل شيء يجب أن يكون عالي"؛ (2) سطح IPC غير المحمي بفحص المُرسِل ما زال واسعًا جدًا (قناة `kdx:agent:run` نفسها غير محمية)؛ (3) سجن مسار playbook/memory جزئي فقط — يمنع `..` وUNC لكنه يسمح بمسارات مطلقة خارج مساحة العمل؛ (4) هناك عدم تطابق بين المصدر والنسخة المبنية: 6 ملفات واجهة عُدّلت بعد بناء المُثبّت بـ 21 دقيقة. التوصية: لا تُطلق حتى تُغلق نقاط P1 الأربع ويُعاد البناء وإعادة التجزئة (rehash).

**English:** No exploitable P0 was found. The launch is **blocked by four P1s**: (1) Windows binaries are still completely unsigned (explicit founder demand); (2) the sender-ungated IPC surface is still very wide — even `kdx:agent:run` is unguarded; (3) the playbook/memory path jail is only partial — it blocks `..`/UNC but still accepts arbitrary absolute paths outside the workspace; (4) a source≠build mismatch: 6 UI files were edited ~21 minutes *after* the installer was built. Do not launch until all four are closed and artifacts are rebuilt/rehashed.

---

## Part 1 — Previously-fixed items: still correct? / التحقق من الإصلاحات السابقة

| # | Item | Status / الحالة | Evidence / الدليل |
|---|------|-----------------|-------------------|
| 1 | `kdx:cmd:run` dialog + allow-list + `shell:false` + minimal env | ✅ INTACT / سليم | Allow-list `CMD_RUN_ALLOW` `ipc.ts:200-203`; meta-char block `CMD_RUN_META` `:204-205`, checked `:224`; argv length 2–16 `:226`; per-exe restrictions `:229-233`; cwd jail `fsSvc.assertSafePath` `:234-237`; explicit `approved` `:238`; minimal env (no keys) `:240-251`; `spawn(..., {shell:false, windowsHide:true, env})` `:280-282`; 512 KB cap + watchdog/SIGKILL `:254, 286-299`; native `dialog.showMessageBoxSync` default=Cancel `:454-463`; inline sender gate `:445-450`. |
| 2 | `isTrustedRenderer` origin list | ✅ INTACT / سليم | `ipc.ts:331-336` — accepts only `surnia://bundle/` (`:333`), `file:` (`:334`), and `http(s)://localhost\|127.0.0.1\|[::1]` with port/path boundary (`:335`); reads **only** `senderFrame.url` (`:332`, never `sender.getURL()`). Local mirror `terminalGuard.ts:810-818`. Playbook mirror `playbook.ts:592-595` (slightly weaker loopback regex — see P1-2 fix). |
| 3 | 28 `handleTrusted` channels | ✅ INTACT / سليم | Exactly **28** registrations: fs `ipc.ts:378-391` (8), term `:434-441` (4), git `:477-483` (7), slashCommands `:702`, git:clone `:752`, worktree `:795-806` (5), git AI helpers `:831-834` (2) — plus `kdx:cmd:run` inline gate (`:450`) = 29 gated channels total. |
| 4 | Playbook IPC path jail + sender check | ⚠️ PARTIAL / جزئي | **Sender check ADDED:** `playbook.ts:588-597` (v11.16 fix). **Path jail incomplete:** `workspaceOf()` `playbook.ts:104-119` only rejects `..` and UNC/device paths (`:110`) — it does **not** require the path to equal the active confine root. `C:\Users\Public` is accepted. Contrast the real jail `fsService.assertSafePath` `fsService.ts:118-145` which enforces `isInsideAnyRoot` (`:137-143`). Same gap in `memory.ts:125-135` (`wsOf` is just `.trim()`) with bare writes at `memory.ts:145-148`. → **P1-2**. |
| 5 | Deep-link pair TTL / one-use / local-account guard | ✅ INTACT / سليم | 15-min TTL `authService.ts:384` (`15*60*1000`), pending map `:390`, code generator `:401`, TTL sweep `:418`, TTL+existence check `:437-438`, **one-use** `pendingPairs.delete(pair)` `:441`, email/plan validation `:443-449`, **local-account guard** `via !== 'website'` → `email_taken` `:453-461`; callback regex + no token logging `main.ts:752-777`. |
| 6 | Webhook token redaction | ✅ INTACT / سليم | `scheduleService.ts:700-705` — logs only `wh.token.slice(0,4)…` with an explicit "never print" comment. No full token/key logged anywhere in `electron/` (grep for secret-bearing `console.*` returned only masked/sliced forms: `storeService.ts:114`, `remoteService.ts:252,684`, `apiServerService.ts:157,286`). |
| 7 | No `eval` / `new Function` / `dangerouslySetInnerHTML` in renderer | ✅ INTACT / سليم | `src/`: zero real sinks (only a doc comment `SearchPanel.tsx:45`). `electron/`: `innerHTML` only in `previewService.ts:409,543,545,551` and `remoteService.ts:422,437,440` — all escape input with `esc()` first and run in the isolated preview/remote webview (no nodeIntegration, `main.ts:698-711`). Website: only static, non-user content. |
| 8 | CSP header + hashed scripts + sidecar shipped in asar | ✅ INTACT / سليم | `main.ts:122-193`: strict CSP on every `surnia://` document (`:223`), `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` (`:189-192`); **no `unsafe-eval`** — the only eval-like token is `wasm-unsafe-eval` built at `:167-168` (WebAssembly only). Sidecar read at `main.ts:143-155`; generated `scripts/post-build.mjs:110-130`. **Verified by extraction:** `dist/csp-hashes.json` and the copy inside `release/win-unpacked/resources/app.asar` are byte-identical (`entryHash sha256-fvpPCMB7…`, `bootHash sha256-aMlgk+A…`). |
| 9 | Artifact hashes | ✅ MOSTLY INTACT / سليم مع ملاحظة | `website/lib/site.ts:22-23` (`d2ff19c2…`, `281c38c6…`) **match** the on-disk artifacts exactly (computed `D2FF19C2…` / `281C38C6…`). `website/public/updates/latest.yml` sha512 `YUXQMDFc…` matches the EXE (computed). ⚠️ `release/SHA256SUMS.txt` is **missing** (the prior audit cited it) — regenerate it. |

---

## Part 2 — NEW issues from the 19-agent wave / مستجدات الموجة

**Clean checks / فحوص سليمة:**
- **No new IPC handlers** in the wave files (`ContextLens.tsx`, `CommandPalette.tsx`, `Rail.tsx`, `App.tsx`, `prompts.ts`, `context-orb.css` — mtimes 21:05–21:06). They are renderer-only; grep for `ipcMain`/`fs` in them returned nothing.
- **No new file writes outside the workspace** in the wave files.
- **No new secret in logs** — see item 6 above.
- **No new `dangerouslySetInnerHTML`** — see item 7 above.
- ✅ The security-critical source files all predate the release build (`playbook.ts` 17:55, `memory.ts` 18:04, `ipc.ts` 2026-11-18 23:00, `main.ts` 15:24, `authService.ts`/`scheduleService.ts` 2026-11-18 18:37, `fsService.ts` 2026-11-16, `post-build.mjs` 15:23 — all before the 20:41 build), so the shipped binary **does** contain the security fixes. No P0 regression in the binary.

---

## P0 — none found / لا توجد (تصريح صريح)

I specifically searched for and did **not** find: shell injection via `kdx:cmd:run`, unauthorized deep-link account takeover, secret leakage into logs/notices/memory, renderer HTML/script injection sinks, watchdog/abort disablement, or a source≠build mismatch affecting security code.

---

## P1 — launch blockers / عوائق الإطلاق

### P1-1 — Windows binaries are still unsigned (founder's explicit demand) / الملفات غير موقّعة

**Evidence:** `electron-builder.yml:24-75` — the entire "WINDOWS CODE SIGNING — PRESENT BUT DISABLED" block; every signing line is commented (`:46-71`). It states verbatim that installers/ZIPs are UNSIGNED and no certificate exists. `package.json:47` `dist:win` has no signing step. `website/docs/SIGNING.md` exists but is not acted upon.
**Impact:** SmartScreen "Windows protected your PC", no publisher authenticity, no tamper-evidence — for an app that stores API keys and can run test commands. Not remotely exploitable in code, but a non-negotiable blocker given "high security".
**Minimal fix:** procure an **EV** Authenticode cert (OV no longer builds SmartScreen reputation for new files) or Azure Trusted Signing; set `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` in CI (never commit); uncomment `electron-builder.yml:46-71`, add RFC3161 timestamp, rebuild `npm run dist:win`, regenerate `latest.yml` + hashes. **If no cert before launch → founder GO/NO-GO decision and the download page must honestly say "unsigned".**

### P1-2 — Playbook/memory `.surnia` writes are not confined to the workspace (residual) / سجن المسار غير مكتمل

**Evidence:** sender gate added at `playbook.ts:588-597`; path guard `workspaceOf()` `playbook.ts:104-119` rejects `..` and UNC but **not** arbitrary absolute paths; writes at `playbook.ts:196-199` (`writeText`) and the IPC write/clear handlers at `playbook.ts:599-606`, `:553-569`. `memory.ts:125-135,145-148` has only `.trim()` and bare writes. Real jail exists but is unused here: `fsService.assertSafePath` `fsService.ts:118-145`, `assertSafeWritePath` `:156-197`.
**Exact reproduction (renderer frame with the preload bridge; must be the app's own frame to pass the new sender gate):**
```js
// passes the playbook sender check (surnia://bundle/) and workspaceOf() guard:
await api.playbookUpdate({
  workspace: 'C:\\Users\\Public',   // absolute, no '..', not UNC → ACCEPTED
  update: { preferences: ['pwned'] }
});
// → creates C:\Users\Public\.surnia\ and writes playbook.json, PLAYBOOK.md,
//   playbook-history.json OUTSIDE the confined workspace.
await api.playbookClear('C:\\Users\\Public'); // deletes them
```
**Impact:** a compromised main renderer frame (XSS) gains a write/delete primitive outside the workspace — bypassing the fs jail that `kdx:fs:writeFile` enforces. Foreign/remote iframes are now correctly rejected, so this is defense-in-depth, not remote RCE.
**Minimal fix:** (a) in `playbook.ts:104-119`, require the resolved workspace to **equal** the active confine root (export a helper from `fsService.ts` and call `assertSafePath`); use `fsSvc.assertSafeWritePath` per sidecar; (b) apply the same jail to `memory.ts:125-135`; (c) align the loopback regex at `playbook.ts:594` with `ipc.ts:335`.

### P1-3 — Sender validation still missing across many self-registered/high-impact channels / قنوات IPC بلا فحص المُرسِل

**Evidence (still ungated after the wave):**
- `kdx:agent:run` — `agent/register.ts:234` (and `:392,403,430,436,442,449,471,484,485,504,532,542,549,568`). `registerAgentIpc(ipcMain, …)` is called with **plain `ipcMain`** at `main.ts:891`, and `ipc` there is `IpcMain` (`:65`) — no sender check. This is the channel that runs the whole agent/tool loop.
- Plugins: `kdx:plugins:installUrl` `services/pluginService.ts:363` (fetches+installs from a URL; scheme-only check, no SSRF guard).
- Updater: `kdx:update:setFeedUrl` `services/updateService.ts:111` (an attacker-controlled https feed can redirect future updates).
- Auth/schedule/API: `ipc.ts:724-727` (`auth:register/login`), `:711-712` (`apiServer:set`), `:768-774` (`schedule:*`).
- Self-registered: `subagents.ts:436`, `flowsService.ts:439`, `dna.ts:831`, `sessionService.ts:662` (`session:transcribe`), `main.ts:627,642,670,686` (`win`, `log`, `openExternal`, `mcp:test`).
**Impact:** same threat model as P1-2 — a compromised/foreign renderer frame reaches the full bridge. CSP/contextIsolation/no-eval make exploitation hard, but the "28 channels gated" guarantee is not true across the dangerous surface.
**Minimal fix:** add one global sender check in the shared `handle()` wrapper (`ipc.ts:304-313`) with an explicit opt-out list for channels that must serve non-app origins; or route every write/spawn/install/settings/auth/network channel through `handleTrusted`. Prioritize `kdx:agent:run`, `plugins:installUrl`, `update:setFeedUrl`, `auth:*`, `schedule:*`.

### P1-4 — Source ≠ built artifact (NEW) / عدم تطابق المصدر والنسخة المبنية

**Evidence:** security source files are older than the build (20:41–20:44), so the binary is safe — but these six files were modified **after** the build: `src/components/ContextLens.tsx` 21:06:39, `CommandPalette.tsx` 21:06:33, `electron/agent/prompts.ts` 21:06:11, `src/components/Rail.tsx` 21:06:02, `context-orb.css` 21:06:01, `src/App.tsx` 21:05:40. `release/SADEEM-Setup-11.12.0.exe` is 20:44:20; `dist/index.html` is 19:26:48. `release/SHA256SUMS.txt` and `release/latest.yml` are absent (the feed lives only in `website/public/updates/latest.yml`).
**Impact:** the shipped installer does not contain the latest reviewed source. Hashes in `site.ts` correctly describe the on-disk binary, so downloads are internally consistent — but launching now means reviewing one tree and shipping another. For a "high security" bar this is unacceptable release hygiene.
**Minimal fix:** `npm run full && npm run dist:win && node scripts/publish-release.mjs`; regenerate `SHA256SUMS.txt`; update `website/lib/site.ts:22-23` hashes; re-verify `latest.yml` sha512 against the new EXE; re-run this audit against the final artifacts.

---

## P2 — hardening / residual risk / تصلب إضافي

- **P2-1 — `web_download` DNS pinning is TOCTOU, not true pinning.** `resolvedHostBlocked()` uses `dnsProm.lookup()` (`tools.ts:3955-3973`) then `fetch()` re-resolves the hostname (`tools.ts:4003-4011`); a rebinding attacker can return a public IP to validation and `169.254.169.254`/loopback to the fetch. Fix: connect to the validated IP via an undici `Agent` with `connect.lookup`.
- **P2-2 — executable download guard is a weak Content-Type denylist.** `tools.ts:4245-4259` omits `application/octet-stream`; no magic-byte/extension check; `allow_unsafe_content:true` bypasses (`:4314,4350-4353`); `fullAccess` auto-approves. 100 MB cap is enforced (`:4310-4312,4355-4378`). Fix: add the MIME, validate magic bytes, refuse `.exe/.msi/.sh/.bat/.ps1` destinations, keep a human gate in `fullAccess`.
- **P2-3 — `fullAccess` intentionally escapes the download jail.** `tools.ts:403-410,424-440` early-return when `fullAccess` — document it; "downloads jailed to workspace" is only true in non-fullAccess modes.
- **P2-4 — `npx` unrestricted in the test allow-list.** `ipc.ts:200-203` allows `npx <any-package>` (downloads+executes npm code); the dialog claims "Only test runners are allowed" (`:461`) — inaccurate. Requires a user click. Fix: remove `npx` or restrict to known test runners; correct the wording.
- **P2-5 — website security headers missing.** `website/vercel.json:9-23` sets only Content-Type/Cache-Control; no CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS. `installCommand: npm install` (`:5`) → use `npm ci`.
- **P2-6 — pair-code/updater domain ≠ canonical site.** App default `https://sadeem.app` (`authService.ts:392-398`, `updateService.ts:27`) vs site canonical `https://sadeem-ai.com` (`website/lib/site.ts:8`) and feed `https://sadeem-website-theta.vercel.app/updates/` (`:27`). Verify founder control of `sadeem.app`; unify to one `SADEEM_SITE_URL`.
- **P2-7 — raw upstream error text in failover notices.** `providers.ts:1748-1752,1813-1819`, `engine.ts:4663,5688-5689` include `err.message.slice(0,120)`. No key leak found (401 static `:517-521`), but add a scrub regex for `api_key|Bearer|token` before emitting.
- **P2-8 — `allowOnce` trusts any app-frame renderer.** `terminalGuard.ts:810-829` closes the foreign-frame case; a compromised main frame can still arm an exception. Accepted residual.
- **P2-9 — release integrity files missing.** `release/SHA256SUMS.txt` and `release/latest.yml` are absent; regenerate with `scripts/publish-release.mjs` so download verification and the updater feed are reproducible from the release folder.

---

## Priority summary / ملخص الأولويات

| ID | Severity | One-line / الخلاصة | Location |
|----|----------|--------------------|----------|
| P1-1 | Blocker | Unsigned Windows binaries (founder demand) | `electron-builder.yml:24-75`, `package.json:47` |
| P1-2 | Blocker | Playbook/memory `.surnia` writes not confined to workspace (sender gate added, jail partial) | `playbook.ts:104-119,196-199,588-606`; `memory.ts:125-148`; `fsService.ts:118-197` |
| P1-3 | Blocker | Sender validation missing on `kdx:agent:run`, plugins, updater, auth, schedule, and other self-registered channels | `register.ts:234+,65`; `main.ts:891`; `pluginService.ts:363`; `updateService.ts:111`; `ipc.ts:724-727,768-774` |
| P1-4 | Blocker (NEW) | Source≠build: 6 UI files edited 21 min after installer build; SHA256SUMS/latest.yml missing from release | file mtimes; `release/`; `website/lib/site.ts:22-23` |
| P0 | — | none found / لا توجد | — |
| P2-1…P2-9 | Hardening | DNS TOCTOU, executable blocklist, fullAccess escape, `npx`, website headers, domain mismatch, error scrubbing, allowOnce, release integrity | see above |

**Final verdict / الحكم النهائي:** ❌ **NOT SAFE TO LAUNCH** until P1-1, P1-2, P1-3 and P1-4 are closed and the artifacts are rebuilt, rehashed and re-audited. With those four fixed, the residual P2s are acceptable for a "high security" launch provided the self-asserted-website-identity and unsigned/transition caveats are communicated honestly. / **لا تُطلق** حتى تُغلق النقاط الأربع ويُعاد البناء والتجزئة والتدقيق؛ بعدها يمكن تقبّل نقاط P2 كتحسينات مع الإفصاح الصادق عن هوية الموقع ذاتية الإعلان (self-asserted) ومرحلة التوقيع.
