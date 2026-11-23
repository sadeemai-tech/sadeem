# P0 DIAGNOSIS — App Launch → First Provider Request (first-message latency)
# تشخيص P0 — من إقلاع التطبيق إلى أول طلب للمزوّد (بطء الرسالة الأولى)

Date: 2026-11-19 · Scope: `electron/main.ts`, `electron/ipc.ts`, `electron/agent/{register,engine,mcp,dna,playbook,skills}.ts`, `electron/services/{storeService,openrouterCatalog,updateService,mcpRegistryService}.ts`, `src/{store.ts,components/StatusBar.tsx,components/ModelPicker.tsx}`.

**Posture: DIAGNOSIS ONLY — لا ينتمي أي تعديل على أي ملف مصدر.** Measurements used a read-only Node harness at `D:\ORION\data\cache\tmp\opencode\boot-latency-measure.mjs`.

Companion report: `docs/DIAG-LATENCY.md` covers *what happens after* the request is sent (130 KB payload, 119 tool schemas). This report covers everything *before* the first byte reaches the provider.

---

## 0. HEADLINE / الخلاصة (اقرأ هذا أولاً)

**The founder's "أول ما أرسل له رسالة يقعد مليون سنة يرد" is NOT caused by the OpenRouter catalog and NOT primarily by `getSettings()`.** It is caused by **MCP**.

At app launch, `mcp.ts` starts a health monitor that **spawns every enabled MCP server immediately** (`app.whenReady() → healthTick() → healthProbe() → withClient() → child_process spawn`). On this machine the user has **3 enabled stdio servers, all `npx -y …`**. A cold `npx -y @modelcontextprotocol/server-…` performs an **npm registry lookup/download** — i.e. the real app *does* make a network call at startup, just not the one the earlier report suspected. Then, when the first message is sent, `runAgent()` **awaits `mcpListTools()` for all 3 servers with a hard 10 s timeout each** before it builds the prompt and calls the provider. Send a message in the first ~10–30 seconds after launch and you join those cold spawns; the provider request waits up to **10 s** for MCP discovery alone.

السبب الحقيقي هو الـ MCP وليس كتالوج OpenRouter ولا قراءة الإعدادات. عند الإقلاع يبدأ مراقب صحة يقلّع **كل** سيرفرات MCP المفعّلة فوراً (3 سيرفرات على هذا الجهاز، كلها `npx -y …` ⇒ طلب شبكة إلى npm على باردة الكاش). وعند إرسال الرسالة الأولى ينتظر المحرّك `mcpListTools()` لكل سيرفر **بمهلة 10 ثوانٍ** قبل بناء البرومبت وإرسال الطلب للمزوّد. النتيجة: انتظار حتى 10 ثوانٍ قبل أن يبدأ الرد أصلاً.

**Ranked worst-case addition to the first message: ~10,000 ms (MCP) ≫ ~200 ms (repeated settings reads) > ~0 ms (OpenRouter, update check).**

---

## 1. THE THREE HYPOTHESES — VERDICT / حكم الفرضيات الثلاث

| Hypothesis | Verdict | Evidence |
|---|---|---|
| `openrouterCatalog` is fetched at boot and blocks | **FALSE — no change needed** | `openrouterLiveModels()` is only called from `ipc.ts:667-671` (`kdx:models:openrouter`, invoked by `ModelPicker.tsx:291-309` **only when the picker is open**) and `providerService.ts:375` (`enableProvider`, a user action). It has a 12 s timeout + 10 min cache (`openrouterCatalog.ts:29-32,83-106`) but is never on the boot/first-run path. |
| MCP health checks run before/block the first agent run | **TRUE — the dominant cause** | Health monitor starts at module load (`mcp.ts:2611,2633`) and fires an immediate `healthTick()` on `app.whenReady()` (`mcp.ts:2418-2426`). `StatusBar.tsx:417-433` fires a second full probe on mount. `engine.ts:1891-1909` **awaits** per-server tool discovery with `MCP_DISCOVERY_TIMEOUT_MS = 10_000` (`engine.ts:192`) before `streamTurn()`. |
| `getSettings()` sync disk reads are slow | **REAL but minor (~0.5 ms/call warm, measured)** | `storeService.ts:162-170,197-221` does `readFileSync + JSON.parse + migrate + safeStorage.decryptString` on **every** call, with no cache. It is called ~15–20× from launch to first token (see §2). On a cold Windows Defender cache this is 5–20× higher, so it can add tens of ms and blocks the main event loop — but it is not the "مليون سنة" cause. |

**Additional honest finding:** there is **one real network-at-boot path** — the 3 `npx -y …` MCP spawns hit `registry.npmjs.org` when the npm cache is cold. If the machine is offline or DNS is slow, npm's own retry timeouts are far longer than the 10 s MCP probe timeout, so the failed children keep burning CPU/IO in the background while the user is typing. `updateService.scheduleAutoCheck()` (`updateService.ts:163-172`) is **not** a culprit: it is a `setTimeout(…, 10 min)` with `.unref()` and a lazy `import('electron-updater')` (`updateService.ts:71-75`).

---

## 2. FULL TIMELINE — LAUNCH → FIRST PROVIDER REQUEST / الجدول الزمني الكامل

All entries are on the main-process critical path unless marked *fire-and-forget*. Sync operations block the Electron main event loop.

### Phase A — module load & pre-`whenReady`
| # | Operation | Location | Cost class |
|---|---|---|---|
| A1 | `pinStableUserData()`: `mkdirSync`, plus a **whole-directory `fs.cpSync`** of a legacy `Surnia`/`Electron` profile if `settings.json` is absent (one-time migration) | `main.ts:47-75` | sync disk; usually ms, **one-time can be seconds** |
| A2 | `initLog()` — opens/rotates the log file | `main.ts:76` | sync disk |
| A3 | `RENDERER_CSP` built at module scope → `rendererScriptSrc()` → `readFileSync(dist/index.html)` to extract CSP hashes | `main.ts:141-164` | sync disk read of the bundle |
| A4 | `registerMcpV2Ipc()` at module load → **`startHealthMonitor()`** | `mcp.ts:2611,2630-2633` | installs hook; next phase spawns processes |
| A5 | All ~35 service modules imported (each may have module-level init; `pluginService` self-registers at `pluginService.ts:384`) | `ipc.ts:8-73`, `main.ts:6-36` | CPU parse, some sync disk |

### Phase B — `app.whenReady()` (`main.ts:828-900`)
| # | Operation | Location | Cost class |
|---|---|---|---|
| B1 | `serveRenderer()` — registers the privileged `surnia://` handler | `main.ts:830,178-221` | cheap |
| B2 | `registerIpc()` → `logs.setLogLevel(store.getSettings().logs?.level)` | `main.ts:858`; `ipc.ts:353`; `storeService.ts:197` | **sync disk read #1** |
| B3 | `scheduleAutoCheck()` → `getSettings()` (checks `updates.autoCheck`) | `main.ts:859`; `updateService.ts:163-165` | **sync read #2**, timer deferred 10 min |
| B4 | `initApiServer()` → `apiCfg()` → `getSettings()`; if enabled, `persistCfg({})` + `void startServer()` (binds a port) | `main.ts:860`; `apiServerService.ts:352-370,168` | **sync read #3** + optional socket bind |
| B5 | `initRemoteServer()` → `getSettings()`; LAN listener if enabled | `main.ts:861`; `remoteService.ts:718,244` | **sync read #4** + optional socket bind |
| B6 | `initScheduleService()` → `loadJobs()` (`readFileSync`) + starts a webhook listener on 127.0.0.1:7681 + 30 s ticker | `main.ts:863-872`; `scheduleService.ts:688-706,97` | sync disk + socket bind |
| B7 | `initTray()` | `main.ts:873` | native tray icon |
| B8 | `registerAgentIpc()` → `initFlows()` (sync read of flows file) + remote bridge wiring | `main.ts:874`; `register.ts:65-67`; `flowsService.ts:467,90` | sync disk |
| B9 | `createWindow()` → `loadWindowState()` (`readFileSync`) → `loadIndex()` → `loadURL('surnia://bundle/index.html')` | `main.ts:895,284,368-391`; `windowStateService.ts:37` | sync disk + renderer load |
| B10 | **MCP health monitor first tick**: `healthTick()` → `safeServers()` = `getSettings()` → `Promise.all(servers.map(healthProbe))` → `mcpProbeServer` → `withClient()` → **spawn every enabled MCP server** | `mcp.ts:2418-2426,2370-2413,2286-2293,1900-1934,2251-2257` | **sync read #5 + N child process spawns (npx → npm network on cold cache), 10 s probe timeout** — *fire-and-forget, but saturates CPU/IO exactly when the user types* |

### Phase C — renderer hydration (`src/main.tsx` → `src/store.ts`)
| # | Operation | Location | Cost class |
|---|---|---|---|
| C1 | `createRoot().render(<App/>)` then `useStore.getState().init()` | `main.tsx:109-145` | React mount, then: |
| C2 | `Promise.all([api.getSettings(), api.licenseGet(), api.listSessions()])` → 3 IPC round-trips → main does `getSettings()` (**sync read #6**), `getLicense()` (sync read), `readdirSync(sessions)` | `store.ts:1774-1793`; `ipc.ts:486-493,553` | 3 sync disk reads on main + IPC latency |
| C3 | `api.authCurrent()` → account file read | `store.ts:1799` | sync read on main |
| C4 | `StatusBar` mounts → `api.mcpServersGet()` → `kdx:mcp:servers` → `mcpRegistry.listServers()` → `servers()` = `getSettings()` (**sync read #7**) → **`mcpProbeServer` for all enabled servers again** (joins the B10 in-flight `starting` promise, so mostly deduped — but still a full 3-list probe and a 60 s repeat) | `StatusBar.tsx:414-433`; `ipc.ts:615`; `mcpRegistryService.ts:498-517,284-286` | **duplicate MCP probe at the worst possible moment** |
| C5 | User opens a workspace → `updateSettings({recentPaths})` → `saveSettings()` = `readJson + encrypt + writeFile + getSettings()` (**sync reads #8–9**) | `store.ts:2005-2007`; `storeService.ts:231-279` | sync disk write + 2 reads |
| C6 | `await refreshTree()` → `api.readDir(wsPath)` recursive tree scan of the whole workspace | `store.ts:2008,2017-2024` | **awaited** disk traversal; can be seconds on a big repo / `node_modules` |
| C7 | Fire-and-forget: `loadGit()` (spawns `git`), `loadSkills()`, `loadDna()`, `loadPlaybook()`, `loadSubagents()`, `newSession()` | `store.ts:2009-2014` | competing CPU/disk while the user starts typing |

### Phase D — first message (`kdx:agent:run` → `streamTurn`)
| # | Operation | Location | Cost class |
|---|---|---|---|
| D1 | `checkGate('run')` → `getSettings()` (**sync read #10**) | `register.ts:259`; `billingService.ts:135-168` | sync disk |
| D2 | Credential injection → `getSettings()` (**sync read #11**) | `register.ts:307-312` | sync disk |
| D3 | `enabledPluginMcpServers()` → reads plugin manifests | `register.ts:317-319`; `pluginService.ts:42-50` | sync disk |
| D4 | `sessions.load(sessionId)` (fire-and-forget for remote mirror) + `runAgent(params, io)` | `register.ts:344-353` | async disk |
| D5 | `getSettings().permissionMode` (**#12**) | `engine.ts:1362` | sync disk |
| D6 | `loadApprovalRules()` + `loadDenyRules()` | `engine.ts:1430,1436` | 2 sync disk reads |
| D7 | `agentTuning()` → `getSettings()` (**#13**); `resolveCredentials()` → `getSettings()` fallback (**#14**); `getSettings().language` (**#15**); `getSettings().checkpointsEnabled` (**#16**); `dnaEnabledSetting()` → `getSettings()` (**#17**) | `engine.ts:1452/1193,1766/5489,1773,1838,2089/814` | **6 more sync reads/decrypts on the first message** |
| D8 | Read `AGENTS.md`, `KODEX.md`, `MEMORY.md` from the workspace | `engine.ts:1862-1874` | 3 async reads (usually ENOENT) |
| D9 | `machineCapabilitySummaryNow()` — **already fixed** in v11.10: zero-spawn, warms in background | `engine.ts:1881-1885`; `tools.ts` | fast now (used to block ~1 s across 21 runtime spawns) |
| D10 | **MCP tool discovery — `await Promise.all(servers.map(mcpListTools(server)))` with 10 s timeout each** | `engine.ts:1891-1909`, timeout const at `engine.ts:192` | **UP TO 10,000 ms — #1 cause** |
| D11 | `await toProviderMessages(...)` (image attachments may be read from disk) | `engine.ts:1912,5524` | async |
| D12 | `await loadHooks()` + **await `runSessionStartHooks()` + `runUserPromptHooks()`** — spawns configured hook commands, **no timeout** | `engine.ts:2027,2041-2048`; `hooks.ts` | 0 ms with no hooks; **unbounded if the workspace has hooks** |
| D13 | Skills index `statSync`; `dna.loadDNA(workspace)` (sync read of `dna.json` + workspace `.surnia/dna.json`); `playbook.loadPlaybook(workspace)` (sync read of `PLAYBOOK.md`) | `engine.ts:2063-2103`; `dna.ts:137-162,225`; `playbook.ts:199-213` | small sync reads; **measured ~0.7 ms for the 21 KB `dna.json`** — lazy, not at boot, not a real bottleneck |
| D14 | `getToolDefs()`, `startRunJournal()` (writes a JSONL file), `buildSystemPrompt()` | `engine.ts:2055,2547,2104` | CPU; see `DIAG-LATENCY.md` for the ~130 KB payload |
| D15 | **First provider HTTP request: `await streamTurn({...})` in `agentLoop`** | `engine.ts:2493,4275`; `providers.ts` | the moment the user is waiting for |

---

## 3. RANKED CAUSES / الأسباب مرتّبة (Top 5)

1. **MCP cold spawn at boot + awaited MCP discovery on first run — up to 10,000 ms.**
   `mcp.ts:2418-2426` spawns all enabled servers on `app.whenReady()`; `StatusBar.tsx:417-433` triggers a duplicate probe on mount; `engine.ts:1891-1909` **awaits** `mcpListTools()` for each enabled server under a 10 s ceiling. This machine: 3 `npx -y …` servers (`@modelcontextprotocol/server-filesystem`, `server-sequential-thinking`, `server-everything`) — cold npm resolution = real network I/O. Even when pooled clients are warm, `withClient()` joins an in-flight `starting` promise (`mcp.ts:1251-1253`), so an early message still waits for the cold spawn. The pool is capped at **8 live clients** (`mcp.ts:1242 POOL_MAX_LIVE = 8`), matching the worst-case "8 servers × 10 s probe" concern in the brief — probes are parallel, so the ceiling is 10 s total, not 80 s. **This is the "مليون سنة".**

2. **Workspace tree scan blocks workspace readiness — hundreds of ms to seconds.**
   `store.ts:2008` `await get().refreshTree()` recursively walks the whole open folder (`fsService.readDirTree`) before the rest of `openWorkspace()` settles. Not literally inside `runAgent`, but it competes for disk/CPU right when the user is about to send, and on a large workspace the composer feels frozen.

3. **Awaited lifecycle hooks with no timeout — 0 ms normally, unbounded if configured.**
   `engine.ts:2041-2048` awaits `runSessionStartHooks()` and `runUserPromptHooks()`. A workspace imported from Claude Code / Codex conventions with `.surnia/hooks` can add an arbitrary number of seconds to the first message, and there is no per-hook timeout.

4. **Uncached `getSettings()` — ~0.5 ms/call warm, but called 17× and blocks the main loop.**
   `storeService.ts:162-170,197-221`. Measured on the real 21 KB `settings.json`: **0.481 ms/call** warm (200 iterations); cold on Windows Defender can be 5–20×. The repeated safeStorage decrypts and JSON.parse are pure waste; on a large `usageLog` the file grows and so does every one of the 17 reads.

5. **DNA / playbook / skills / memory disk reads at run start — small (~0.7 ms measured for `dna.json`), lazy (not boot), but synchronous on the main loop.**
   `engine.ts:2063-2103`, `dna.ts:225`, `playbook.ts:199`. Included for completeness; **not worth optimizing for this P0.**

**Explicitly NOT causes:** OpenRouter live catalog (picker-only), auto-update check (10 min deferred, lazy import), update feed URL fetch (none at boot), `machineCapabilitySummaryNow` (already fixed). MCP *remote HTTP* servers would add a genuine network probe at boot, but this machine has none configured.

---

## 4. REAL MEASUREMENTS / قياسات فعلية

Harness: `D:\ORION\data\cache\tmp\opencode\boot-latency-measure.mjs` (read-only; reads the real `%APPDATA%\SADEEM\settings.json`, mirrors `getSettings()` work). Run on this machine, 2026-11-19:

```
settings.json bytes: 21335
providers: openrouter, mistral
usageLog entries: 5
mcpServers total: 3   enabled: 3   (all stdio / npx / default timeout)
  0c407282  ON  npx  -y @modelcontextprotocol/server-filesystem ${workspace}
  3b6e3b08  ON  npx  -y @modelcontextprotocol/server-sequential-thinking
  91131990  ON  npx  -y @modelcontextprotocol/server-everything

readFileSync+JSON.parse only : 0.498 ms/call  (200 calls)
getSettings() equivalent     : 0.481 ms/call  (200 calls)
dna.json read+parse          : 0.696 ms/call  (200 calls)
```

**Honest caveat:** these are **warm-cache** numbers (files already in the OS page cache). A cold start after reboot / Windows Defender scan can be 5–20× higher. I did **not** measure actual `npx` spawn time because that would require launching the servers (side effects, network downloads) — I am not claiming a number I did not measure. The 10,000 ms figure is the **code-enforced ceiling**, not a measurement. The mock test's ~2 s `engineStartup` never exercised any of these paths.

---

## 5. MINIMAL FIX SET — exact file:line / الإصلاح الأدنى (لم يُطبّق)

Ordered by impact/effort. **No source file has been edited** — these are prescriptions for the implementing agent.

### FIX 1 (P0, required) — take MCP discovery off the first-message critical path
- `electron/agent/engine.ts:1891-1909`: replace the awaited `Promise.all(mcpListTools(...))` with a **synchronous read of the already-populated annotation cache**. `mcp.ts` already calls `cacheAnnotations(server.id, tools)` at `mcp.ts:1913` and `mcp.ts:1694` during the boot probe. Export a `cachedMcpToolsFor(serverId)` helper from `mcp.ts` (mirror `openrouterCatalog.ts:119-121 cachedOpenRouterModels()`) and use it in the engine; only fall back to async discovery for servers with no cache, and mark those tools as "available next turn". This removes the entire 10 s ceiling from the first message.
- `electron/agent/engine.ts:192`: if async fallback is kept, lower `MCP_DISCOVERY_TIMEOUT_MS` from `10_000` to `2_000` (and/or make it env-tunable like `SURNIA_DECISION_TIMEOUT_MS` at `register.ts:40-43`). A broken MCP server should never cost the user 10 s of silence.
- `electron/agent/mcp.ts:2418-2426`: **do not call `void healthTick()` immediately on `app.whenReady()`**. Start only the interval (or delay the first tick 30–60 s, or trigger it after the first agent run completes / the user opens the MCP panel). Cold `npx` spawns must not compete with the first message.
- `src/components/StatusBar.tsx:417-433`: drop the mount-time `api.mcpServersGet()` full probe; use the cheap in-memory health snapshot (`kdx:mcp:health:get`, registered at `mcp.ts:2464`) for the badge, and keep only the 60 s refresh. This removes the duplicate 3-server probe at launch.

### FIX 2 (P0, trivial) — cache settings in memory
- `electron/services/storeService.ts:82` (or near): add `let settingsCache: AppSettings | null = null;`.
- `electron/services/storeService.ts:197-221`: at the top of `getSettings()`, `if (settingsCache) return settingsCache;`; assign `settingsCache = result` immediately before the `return` at line 220.
- `electron/services/storeService.ts:231-279`: invalidate (`settingsCache = null`) after the write at line 277, or simply return the value already obtained from line 278's `getSettings()`.
- Effect: eliminates ~17 sync `readFileSync + JSON.parse + safeStorage.decryptString` cycles between launch and first token, and unblocks the main event loop. No behavior change for settings edits (`saveSettings` is the only writer in this codebase; the settings file is not externally mutated).

### FIX 3 (P1) — make hooks non-blocking on the first turn
- `electron/agent/engine.ts:2041-2048`: change `await fireLifecycle(...)` to `void fireLifecycle(...)` for **SessionStart** and **UserPromptSubmit** (their returned `context` is informational; inject it as a `sys_notice` when it arrives), or skip them entirely for the first turn of a fresh session. Add a per-hook timeout (e.g. 2 s) in `hooks.ts` if `await` must be kept.

### FIX 4 (P1) — do not block chat readiness on the directory scan
- `src/store.ts:2008`: `await get().refreshTree()` → `void get().refreshTree()`. The tree already sets `treeLoading: true` and fills in when done; the composer does not need to wait for a recursive walk of `node_modules` before accepting the first message.

### FIX 5 (P2, verification only — no change recommended)
- `src/components/ModelPicker.tsx:291-309` and `electron/services/updateService.ts:163-172` are already correct: catalog fetch is gated on picker-open + key, update check is deferred 10 min and `.unref()`'d. Leave them alone. Do **not** "fix" `openrouterCatalog` — it is not on this path.

### Expected result of FIX 1 + FIX 2
First-message pre-provider wait drops from **up to ~10 s (+ competing npx spawns)** to **~0–100 ms** on a warm pool, with no loss of MCP tools (they arrive from the boot cache) and no change to the request payload. `getSettings()` becomes O(1) memory after boot.

---

## 6. WHAT WAS NOT VERIFIED / حدود التشخيص

- I did not run the packaged Electron app (no GUI session), so no end-to-end stopwatch from launch to first token. Timings are from static analysis of the awaits plus a read-only Node benchmark of the real settings file.
- I did not measure actual cold `npx` spawn duration (would downloads packages / start servers — side effects beyond diagnosis scope). The 10 s number is the code ceiling at `engine.ts:192`.
- `machineCapabilitySummaryNow`, hooks, and image attachments are environment-dependent; a workspace with hooks or large image attachments will be slower than the numbers above.
- The legacy-profile `fs.cpSync` at `main.ts:65` is one-time only and did not apply on this machine (both `SADEEM` and `Surnia` settings files exist).
