# CRITICAL SECURITY AUDIT — SADEEM v11.16 (pre-launch, post-merge)

**Audit date:** 2026-11-19
**Auditor:** security subagent — **read-only on all application source**. Only this file was created.
**Scope:** 12 merged agent workstreams (new tools, memory writes, long-run, permission changes, website). All 10 requested audit areas, read-only, with `file:line` citations.
**Baseline for comparison:** `docs/LAUNCH-AUDIT.md` (2026-11-18) — its P0-1/P0-2 and most P1s were reported as fixed; this audit verifies the fixes and hunts for NEW regressions.

> **Line-number caveat:** source was still being edited by other agents during this audit. All `file:line` values are accurate at the time of writing. Re-verify before any fix.

---

## VERDICT

> **NOT SAFE TO LAUNCH AS-IS.** — **لا تُطلق الآن.**

**No P0 (exploitable remote-code-execution / auth-bypass) regression was found.** The prior audit's two P0s are genuinely fixed: `kdx:cmd:run` is now deny-by-default, dialog-gated, allow-listed, `shell:false`, minimal-env, cwd-jailed, and sender-gated; the source/build/hash snapshot mismatch is gone (the current `dist-electron` contains `web_download`, `memorySnapshot`, `SURNIA_LONG_RUN`, `handleTrusted`, and the hardened `kdx:cmd:run`; `SHA256SUMS.txt` matches the artifacts on disk).

The launch is blocked by **three P1s** that the founder's "high security" bar makes non-negotiable:

1. **P1-1 — Windows binaries are still unsigned.** Every signing line in `electron-builder.yml` is commented out. This is a direct, explicit violation of the founder's demand.
2. **P1-2 — NEW IPC channels introduced by the playbook/memory workstream are registered WITHOUT the `isTrustedRenderer` gate and write to `<workspace>/.surnia/` via un-jailed `path.join`, yielding an arbitrary file write/delete primitive.**
3. **P1-3 — The 28-channel sender-validation guarantee does not cover the many new self-registered channels** (playbook, memory, plugins, flows, subagents, MCP, schedule, auth, apiServer). This is the exact class of regression the `handleTrusted` hardening was meant to prevent.

plus P2 hardening gaps (DNS-rebinding TOCTOU in `web_download`, weak executable blocklist, an over-broad `npx` allowance, website security headers, a domain mismatch that sends pair codes to a different host than the canonical site).

**Recommendation to parent:** hold launch until P1-1/2/3 are closed. They are small, local changes (signing config + route new write channels through `handleTrusted` + jail the sidecar writes). Everything else is defense-in-depth.

---

## P0 — none found (explicit)

I searched for and did **not** find: shell injection through `kdx:cmd:run`, unauthorized deep-link account takeover, secret leakage into logs/notices/memory, renderer HTML/script injection sinks, watchdog/abort disablement, or a source/build artifact mismatch. Details in "Verified safe" below.

---

## P1 — must fix before launch

### P1-1 — Windows code signing is completely absent (founder's explicit demand)

**Evidence**
- `electron-builder.yml:24-75` — a large block titled "WINDOWS CODE SIGNING — PRESENT BUT DISABLED" states verbatim: *"today's installers and ZIPs are UNSIGNED … We do not have one yet, so every signing line below stays commented"*. All of `certificateFile`, `certificatePassword`, `signingHashAlgorithms`, `rfc3161TimeStampServer`, `signAndEditExecutable`, `sign` are commented (`:46-71`).
- `package.json:47` — `"dist:win": "electron-builder --win nsis zip"` produces unsigned artifacts; there is no signing script and no signing env wiring anywhere in `package.json`.
- `electron/services/updateService.ts:11-13` acknowledges unsigned builds; signature verification is skipped.

**Impact** Unsigned NSIS/ZIP → SmartScreen "Windows protected your PC", no publisher authenticity, no tamper-evidence. For a tool that holds API keys and runs shell commands, this is the weakest link in the supply chain. Not remotely exploitable in code, but a launch blocker given the stated requirement.

**Minimal fix (do not change source — report only)**
1. Procure an **EV** (preferred; OV no longer builds SmartScreen reputation for new files — `electron-builder.yml:74-75`) Authenticode cert, or an Azure Trusted Signing account.
2. Set `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` (or `certificateSha1` for a token) in CI — never commit.
3. Uncomment the matching block in `electron-builder.yml:46-71`, add an RFC3161 timestamp, rebuild with `npm run dist:win`, then regenerate `latest.yml` + `SHA256SUMS.txt` via `node scripts/publish-release.mjs` (hashes will change). Full instructions already exist in `website/docs/SIGNING.md`.

**If signing cannot be obtained before launch:** this is a **GO/NO-GO decision for the founder**, not something to silently ship. The download page must state "unsigned" honestly.

---

### P1-2 — NEW playbook/memory IPC channels: no sender gate + un-jailed path join → arbitrary file write/delete

**This is a genuine new vulnerability introduced by the memory/playbook workstream.**

**Evidence**
- The playbook feature self-registers its own IPC with a **local `handle` that ignores the event entirely** — no `isTrustedRenderer`:
  - `electron/agent/playbook.ts:556-560` — `ipcMain.handle(channel, async (_e, ...args) => ...)`.
  - `electron/agent/playbook.ts:561-568` — registers `kdx:playbook:get/history/markdown/clear/update`; `:565-568` passes `input.workspace` straight through.
  - Exposed to the renderer at `electron/preload.ts:367-372` (`playbookUpdate`, `playbookClear`, …).
- The write/delete helpers do **not** jail the path. They only `trim()` the workspace string:
  - `workspaceOf()` — `playbook.ts:104-106` (just `.trim()`).
  - `statePath(ws)` = `path.join(ws, '.surnia', 'playbook.json')` — `playbook.ts:222-224`.
  - `playbookMdPath` / `playbookHistoryPath` — `playbook.ts:108-114`.
  - `writeText()` — `playbook.ts:183-186` (`mkdirSync` + `writeFileSync`, mode 0600 but no containment check).
  - `applySync()` writes all three files at `playbook.ts:450-466`; `clearPlaybook()` deletes them at `playbook.ts:521-537`.
- Same pattern in the new cumulative-memory module: `memorySnapshotPath()` / `memoryHistoryPath()` are bare `path.join(wsOf(workspace), '.surnia', …)` (`electron/agent/memory.ts:123-133`), written at `memory.ts:566-580`; `writeJson()` at `memory.ts:143-146` has no jail.
- Contrast with the correctly hardened surface: `handleTrusted` at `electron/ipc.ts:339-349` and the 28 gated channels at `ipc.ts:378-483`; contrast with `kdx:memory:write` (the *other* memory channel) which **is** jailed via `memoryFile()` → `fsSvc.assertSafePath` and `assertSafeWritePath` (`electron/ipc.ts:838-842, 1084-1095, 1108-1145`).

**Exact reproduction (from any renderer frame that has the preload bridge, including a foreign/sandboxed iframe that fails `isTrustedRenderer`):**
```js
// no approval, no sender check, no path jail:
await api.playbookUpdate({
  workspace: 'C:\\Users\\Public',           // arbitrary absolute dir, or '..\\..\\evil'
  update: { preferences: ['pwned'] }
});
// → writes C:\Users\Public\.surnia\playbook.json, PLAYBOOK.md, playbook-history.json
await api.playbookClear('C:\\Users\\Public');
// → deletes those files
```
The same primitive exists via `memorySnapshot()` if any caller-supplied workspace is attacker-influenced, and via `kdx:playbook:update` with `workspace: '..\\..\\...'` for traversal.

**Impact** A renderer-origin write/delete primitive outside the workspace, bypassing both the sender-origin gate and the FS jail that every other write channel enforces. Exploit precondition: code execution in a renderer frame (XSS, or an embedded remote iframe). The whole reason `handleTrusted` exists (`ipc.ts:315-336`, comment "a foreign/remote frame is still refused") is defeated for these new channels.

**Minimal fix**
1. Register all `kdx:playbook:*` channels through `handleTrusted` (export it from `ipc.ts` or replicate the exact `isTrustedRenderer` predicate) instead of the local unguarded `handle` at `playbook.ts:556-560`.
2. In `applySync`/`clearPlaybook`/`memorySnapshot`, resolve the workspace with `fsSvc.assertSafePath(ws, 'workspace')` and require it to equal the active confine root; use `fsSvc.assertSafeWritePath` for each sidecar target (mirroring `ipc.ts:1108-1145`). Reject `..`, UNC, and absolute paths outside the root.

---

### P1-3 — Sender validation does not cover the new self-registered channels (defense-in-depth regression)

**Evidence**
- Correctly gated (this part is **intact**): exactly **28** channels use `handleTrusted` — `ipc.ts:378-391` (8 fs), `:434-441` (4 term), `:477-483` (7 git), `:702` (slashCommands), `:752` (git:clone), `:795-806` (5 worktree), `:831-834` (commitMessage/review). `kdx:cmd:run` adds its own inline gate (`ipc.ts:445-450`). All 29 use the `surnia://bundle/ | file: | http(s)://localhost|127.0.0.1|::1` predicate (`ipc.ts:331-336`; mirrored in `terminalGuard.ts:810-818`).
- **Not gated** (plain `handle`/`ipcMain.handle`), including new/impactful ones:
  - `kdx:playbook:*` — `playbook.ts:556-568` (see P1-2).
  - `kdx:memory:read/write` — `ipc.ts:838-842` (write is path-jailed, but ungated).
  - `kdx:plugins:installUrl` — `pluginService.ts:363`; `installPluginFromUrl` at `:189-214` checks only `https:` scheme, uses `redirect:'follow'`, no SSRF/DNS guard, no allow-list.
  - `kdx:apiServer:set` — `ipc.ts:711`; `kdx:auth:register/login` — `:724-727`; `kdx:schedule:*` — `:768-774`; MCP OAuth — `:851-867`; `kdx:flows:*`, `kdx:subagents:*` — `flowsService.ts:449-463`, `subagents.ts:283-286`.
  - This was a known P1 in the prior audit (`LAUNCH-AUDIT.md:145-148`); it was only partially addressed (the 28 dangerous channels), and the 12 merged workstreams added more ungated channels.

**Impact** Same threat model as P1-2: any compromised/foreign renderer frame reaches the full bridge. The CSP/contextIsolation/no-eval posture makes this hard to exploit, but the "28 channels gated" guarantee is no longer true across the whole dangerous surface.

**Minimal fix** Route all write/impact channels (at minimum every channel whose handler writes disk, spawns, installs, changes settings/auth, or performs network fetches) through `handleTrusted`, or add a single global sender check in the shared `handle()` wrapper (`ipc.ts:303-313`) with an explicit opt-out list for channels that must serve non-app origins. Prioritize `plugins:installUrl`, `apiServer:set`, `auth:*`, `schedule:*`, `playbook:*`.

---

## P2 — hardening / residual risk (fix soon, not necessarily launch-blocking)

- **P2-1 — `web_download` DNS pinning is TOCTOU, not true pinning.** `resolvedHostBlocked()` resolves with `dnsProm.lookup()` (`tools.ts:3955-3973`) and then `guardedFetch()` passes the **hostname** to `fetch()` (`tools.ts:4003-4011`), which re-resolves independently. A DNS-rebinding attacker can answer the validation lookup with a public IP and the fetch with `169.254.169.254`/`127.0.0.1`. The literal+resolved-IP check on every hop (`:3992-4002`, `:4015-4029`) is real and good, but rebinding defeats it. Fix: connect to the validated IP with a custom dispatcher/`lookup` callback (or undici `Agent` with `connect.lookup`) so the fetched address is the pinned one. Applies to `webDownloadTool` at `tools.ts:4294, 4334-4339`.

- **P2-2 — "Accept executables?" guard is weak.** Default blocking is a Content-Type **denylist** only (`tools.ts:4245-4259`): `application/octet-stream` (the common MIME for `.exe`) is **absent**, there is no magic-byte or destination-extension check, and `allow_unsafe_content: true` bypasses entirely (`:4314, 4350-4353`). In `fullAccess`, approval is automatic, so the model can download an executable with no human gate. The hard 100 MB cap is honored (`:4240, 4310-4312, 4355-4378`). Fix: add `application/octet-stream` to the blocked set, validate magic bytes, refuse `.exe/.msi/.sh/.bat/.ps1` destinations unless explicitly approved, and keep a human approval even in `fullAccess` for executable content.

- **P2-3 — `web_download` can write outside the workspace with `fullAccess` (by design, but document it).** `resolveWriteInWorkspace()` (`tools.ts:403-410`) and `assertWriteTargetInsideWorkspace()` (`:424-440`) both early-return when `ctx.fullAccess === true`. This is the documented escape hatch, not a bug — but it means "downloads are jailed to workspace" is only true in non-fullAccess modes. The native approval card at `:4322-4332` is skipped in fullAccess.

- **P2-4 — `kdx:cmd:run` allow-list includes `npx` with unrestricted arguments.** `CMD_RUN_ALLOW` (`ipc.ts:200-203`) restricts `npm/pnpm/yarn` to test scripts and `node` to `--test`, but `npx`, `jest`, `vitest`, `python*`, `pytest`, `cargo`, `go`, `dotnet` have no argument restriction beyond the shell-metacharacter filter (`:204-205, 225-233`). `npx <arbitrary-package>` downloads and executes arbitrary code from npm. It is gated by the native dialog (`:454-463`) whose text says "Only test runners are allowed" — which is inaccurate for `npx`. Fix: remove `npx` or restrict it to known test runners; correct the dialog wording. Requires user click, so not P1.

- **P2-5 — Website security headers missing.** `website/vercel.json:9-23` sets only `Content-Type` and `Cache-Control`. No `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, or HSTS. Also `installCommand: npm install` (`:5`) instead of `npm ci` (unpinned dependency install in CI). The auth page (`website/app/auth/page.tsx`) is clickjacking-relevant because it hands a deep link to the desktop app. Add the headers and switch to `npm ci`.

- **P2-6 — Pair-code destination domain ≠ canonical site domain.** App default is `websiteBaseUrl() = 'https://sadeem.app'` (`authService.ts:392-398`), and the updater default feed is `'https://sadeem.app/updates/'` (`updateService.ts:27`). The website's canonical address is `'https://sadeem-ai.com'` (`website/lib/site.ts:8`) and its stated update feed is `'https://sadeem-website-theta.vercel.app/updates/'` (`site.ts:27`). `beginWebAuth()` sends the one-time pair code to `<base>/auth.html#pair=…` (`authService.ts:421`). If `sadeem.app` is not founder-controlled, a third party can capture pair codes and create accounts on users' devices; the update feed mismatch is a supply-chain concern. **Verify domain ownership and unify to a single `SADEEM_SITE_URL` / `SITE.siteUrl`.**

- **P2-7 — Provider failover notices carry raw upstream error text.** `providers.ts:1748-1752` (`shortReason`) and `:1813-1819` include `err.message.slice(0,120)` in user-visible notices; `engine.ts:4663` uses `friendlyError(...).slice(0,120)` and `friendlyError`'s fallback returns raw `msg` (`engine.ts:5688-5689`). 401 is sanitized (`providers.ts:517-521`), and 401/403/404/429 paths use static messages in `friendlyError` (`engine.ts:5685-5687`), so no key leak was found — but an upstream gateway that echoes an `api_key` query parameter into a 400/403 body would surface it. Add a scrub regex (`[?&](api_key|key|token)=...`, `Bearer ...`) before emitting notices.

- **P2-8 — `kdx:term:allowOnce` arming (prior P1) now has a sender gate but still trusts any app-frame renderer.** `terminalGuard.ts:810-818, 824-829` gates it with `isTrustedRenderer`, which closes the foreign-frame case; a compromised main frame can still arm an exception. Accepted residual given the renderer is the trust boundary.

---

## Verified safe — area by area (with evidence)

### 1. `kdx:cmd:run` — hardening INTACT after merges ✅
- Allow-list `CMD_RUN_ALLOW` (`ipc.ts:200-203`), shell metacharacter block `CMD_RUN_META` (`:204-205`), argv length 2–16 (`:226`), per-exe restrictions (`:229-233`), cwd jail via `fsSvc.assertSafePath` (`:234-237`), explicit `approved` requirement (`:238`).
- Minimal env with **no API keys/tokens** (`:240-251`), `spawn(..., { shell: false, windowsHide: true, env })` (`:280-282`), output cap 512 KB (`:254, 286-291`), deadline watchdog + SIGKILL (`:253, 294-299`).
- Native `dialog.showMessageBoxSync` **before** spawn, default=Cancel, buttons `['Cancel','Run test']` (`:454-463`).
- `isTrustedRenderer` accepts **only** `surnia://bundle/`, `file:`, and `http(s)://localhost|127.0.0.1|[::1]` with port/path boundary (`:331-336`); reads **only** `event.senderFrame.url` (never `event.sender.getURL()`) so a remote subframe cannot hide behind the main frame (`:327-329`). Local mirror in `terminalGuard.ts:810-818` matches. `kdx:cmd:run` checks it at `:450`.

### 2. `web_download` — guards real, with documented residual (P2-1/2/3) ✅
- Scheme guard refuses `file:/data:/ftp:/javascript:` before I/O (`tools.ts:4290-4293`); host block-list covers loopback/private/link-local/`169.254.169.254`/IPv6 ULA+mapped (`tools.ts:3911-3939`).
- `guardedFetch` validates literal host **and** every resolved IP per hop, re-validates each redirect, max 3 hops, fullAccess never lifts the hop cap (`tools.ts:3941-4033`). DNS-pin TOCTOU is P2-1.
- Dest jailed (`tools.ts:4298-4308` → `:403-410, 424-440`); cap `WEB_DOWNLOAD_MAX_BYTES = 100 MB` clamped and enforced mid-stream (`tools.ts:175, 4240, 4310-4312, 4355-4378`); content-type verification + executable blocklist before any byte written (`:4344-4359`); real path + sha256 reported (`:4380-4404`).

### 3. Memory/playbook writes — jail status split ⚠️
- `MEMORY.md` channel **is jailed**: `memoryFile()` → `assertSafePath` (`ipc.ts:1084-1095`), `writeWorkspaceMemory()` → `assertSafeWritePath` + protected-dir/symlink checks (`ipc.ts:1108-1145`).
- `.surnia/` sidecars (memory snapshot/history, playbook json/md/history) are **not** jailed — bare `path.join(wsOf(workspace), '.surnia', …)` (`memory.ts:123-133`, `playbook.ts:108-114, 222-224`). In normal runs `ws` comes from the engine's validated workspace, so traversal risk is low; the concrete risk is the IPC exposure described in P1-2. No traversal via workspace *name* beyond arbitrary-string workspace input; normal directory names cannot contain `..` as a segment.

### 4. Deep-link auth — hardening INTACT ✅
- 15-minute TTL (`authService.ts:383-384`), sweep on begin (`:416-418`), one-use via `pendingPairs.delete(pair)` (`:441`), pair from 32-char alphabet, 6 chars (`newPairCode `:400-406`), plan allow-list (`:446-449`), email validation (`:445`).
- **"Don't overwrite local account" guard present**: `authService.ts:453-461` — if the email exists and `account.via !== 'website'` (local accounts have `via` undefined — `:27`), returns `email_taken`. Existing website accounts are refreshed in place (`:462-465`).
- Malformed callbacks rejected before minting (`main.ts:768-775`); callback regex restricted to `sadeem://auth/callback?…` (`:752-757`); tokens not logged (`:777` logs ok/error only). Self-asserted-identity model is honestly documented (`LAUNCH-AUDIT.md:134-138`, website `:310-320`).

### 5. Sender validation — 28 channels intact, new channels added without it ⚠️ (P1-2/P1-3)

### 6. Rendering — no injection sinks ✅
- Zero `eval(`, `new Function(`, `dangerouslySetInnerHTML`, or `innerHTML=` in `src/` or `electron/` agent/components. The only `dangerouslySetInnerHTML` in the website is static, non-user content: `website/app/layout.tsx:102-117` (constant theme/motion init scripts; JSON-LD via `JSON.stringify` with `<` → `\u003c`).
- `ClarificationCard.tsx` is pure controlled React: all question/option/description text rendered as children (`ClarificationCard.tsx:287-323`), attribute `data-question` auto-escaped (`:273`), no HTML sinks anywhere in the file.
- Markdown: `react-markdown` with `remarkGfm` (+ `rehypeHighlight` only when settled) and **no `rehypeRaw`** — raw HTML in model output is escaped (`MessageView.tsx:1320-1359, 1402-1408`; `WikiPanel.tsx:284`). Links get `target="_blank" rel="noreferrer"` (`:1321, 1341`).
- Preview viewer's tiny markdown renderer escapes **first**, then applies markup (`previewService.ts:404-408 esc`, `:412-435 mdInline`, `:436+ renderMarkdown`); image `src` re-escaped (`:423-425`), links non-navigating (`:427-430`). `remoteService.ts` interpolations use `esc()` (`:422, 440`). Preview webview has `nodeIntegration=false`, `contextIsolation=true`, no preload, http(s)/loopback-only sources (`main.ts:685-705`).

### 7. Long-run env — watchdog/abort INTACT ✅
- `applyLongRunEnv()` sets only `SURNIA_MAX_RUN_MS/TIME_CAP_GRACE_MS/MAX_TOKENS_CONTINUES/PAUSE_CONTINUES/STREAM_CONTINUE_BUDGET` and never overwrites operator values (`longRun.ts:179-200`). Hard clamps: 24 h max run, 2000 turns, 200 continue rounds (`:41-45`); long-run default wall clock 8 h + 15 min grace (`:58-67`).
- Called once at run start (`engine.ts:1370-1376`). Abort is checked at loop top (`engine.ts:4117`), mid-loop (`:3785, 3805`), and post-retry (`:5171`); retries never retry an abort (`:4600`). Wall-clock cap is enforced gracefully and only when `cap > 0` (`engine.ts:4121-4145`). **No safety watchdog or abort path is disabled.** `SURNIA_MAX_RUN_MS=0` disabling the cap is an explicit operator choice, not something `applyLongRunEnv` does.

### 8. Secrets — no NEW token/key logging ✅
- Failover notices carry `provider/model` names and short reason strings (`providers.ts:1789-1794, 1813-1819`); 401 uses a static message (`:517-521`); 429 uses a static prefix (`:529-533`); `friendlyError` maps known classes to static text (`engine.ts:5667-5689`). No `apiKey` is interpolated into any log/notice (see P2-7 for the one residual).
- Prior P1 webhook-token leak is **fixed**: `scheduleService.ts:699-705` now logs `wh.token.slice(0,4)…` with an explicit "never print" comment.
- Memory writes persist advisory facts (decisions/files/preferences) from journals/playbook/DNA, not secrets (`memory.ts:500-564`); no token/key fields are written.

### 9. Website — trust model unchanged, hash correct ⚠️ (P2-5/6)
- `/auth` stores only `{email,name,createdAt,plan}` in `localStorage['sadeem-web-accounts']`, no password, no backend (`website/app/auth/page.tsx:26-89, 310-320`). Hash parsed in `useEffect`, validated `^[A-Z0-9]{6}$` (`:31-36, 254-270`); callback URL built with `URLSearchParams` to `sadeem://auth/callback` (`:80-89`; `site.ts:10-15`). Trust model matches the prior audit — self-asserted, honestly disclosed.
- **Hash correctness verified by computation:** `SHA256SUMS.txt:2-3` and `site.ts:22-23` match the on-disk artifacts exactly:
  - `SADEEM-Setup-11.12.0.exe` → `10c1a88520b14d503047c8599036af5e6fe5303dfda978f605434796163fa6c5`
  - `SADEEM-11.12.0-win.zip` → `f9fcbfd1e02b5a8e75f039e87795483b54ad513b149fa001c396e87040786109`
  - `latest.yml:8-14` sha512 values match `SHA256SUMS.txt`, `releaseDate 2026-11-19` — artifacts were rebuilt after the source fixes; **no source≠build mismatch**.
- Missing security headers and domain mismatch: P2-5/P2-6.

### 10. Signing — NONE (P1-1) ❌

---

## Priority summary for parent

| ID | Severity | One-line | Location |
|---|---|---|---|
| P1-1 | Blocker | Unsigned Windows binaries (founder demand) | `electron-builder.yml:24-75`, `package.json:47` |
| P1-2 | Blocker | New playbook/memory IPC: no sender gate + un-jailed `.surnia/` writes → arbitrary write/delete | `electron/agent/playbook.ts:104-114,183-186,222-224,450-466,521-568`; `electron/agent/memory.ts:123-146,566-580` |
| P1-3 | Blocker | Sender validation not applied to new self-registered channels | `electron/ipc.ts:303-313,838-842`; `pluginService.ts:363`; `playbook.ts:556-568` |
| P2-1 | Hardening | `web_download` DNS-pin TOCTOU (rebinding) | `tools.ts:3955-4033,4334-4339` |
| P2-2 | Hardening | Executable blocklist = weak Content-Type denylist | `tools.ts:4245-4259,4314,4350-4353` |
| P2-3 | Note | `fullAccess` intentionally escapes download jail | `tools.ts:403-410,424-440,4298-4308` |
| P2-4 | Hardening | `npx` unrestricted in test-cmd allow-list | `ipc.ts:200-233,454-463` |
| P2-5 | Hardening | Website missing security headers; `npm install` not `npm ci` | `website/vercel.json:5,9-23` |
| P2-6 | Verify | Pair-code/updater domain ≠ canonical site domain | `authService.ts:392-398,421`; `updateService.ts:27`; `website/lib/site.ts:8,27` |
| P2-7 | Low | Raw upstream error text in failover notices | `providers.ts:1748-1752,1813-1819`; `engine.ts:4663,5688-5689` |
| P2-8 | Accepted | `allowOnce` trusts any app-frame renderer | `terminalGuard.ts:810-829` |

**Final verdict: NOT SAFE TO LAUNCH until P1-1, P1-2, and P1-3 are closed and the artifacts are rebuilt/rehashed.** With those three fixed, the residual P2s are acceptable for a "high security" launch provided the self-asserted-identity and unsigned/transition caveats are communicated honestly.
