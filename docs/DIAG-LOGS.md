# DIAG-LOGS — hard evidence from actual logs / artifacts (read-only investigation)

**Mode:** evidence gathering only. No application source was modified.
**Investigation date:** 2026-11-18.
**Bottom line:** real runtime logs exist, but **every one of them is from the installed `v11.12.0` build**. There is **not a single log line from the "last wave" (v11.13 / v11.14 source changes)**, because those changes were never built into the installed app that produced these logs. The concrete, reproducible agent-facing error in the artifacts is **provider HTTP 429 / 401 from free OpenRouter models**, not a `TypeError`, `ReferenceError`, `UNTRUSTED_SENDER`, or watchdog kill.

---

## 1. TOP CONCRETE ERROR (from artifacts, not speculation)

```
2026-11-18T19:41:37Z  session fe01d304-…  assistant[model:"error"]:
    Invalid API key (401/403). Check Settings → AI providers.
2026-11-18T19:47:58Z  session fe01d304-…  text:
    [failover] openrouter/nvidia/nemotron-3.5-super-vl:free failed
    (Rate limited (429) — retry shortly.) → continuing on mistral/codestral-2508 with full state
2026-11-18T19:52:08Z  session fe01d304-…  text:
    [failover] openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free failed
    (Rate limited (429) — retry shortly.) → continuing on mistral/codestral-2508 with full state
2026-11-18T19:52:11Z  session fe01d304-…  task-report: outcome "completed" (after 2 failovers)
```

**Source:** `C:\Users\acer\AppData\Roaming\sadeem\sessions\fe01d304-a47b-4b43-b8c5-67e9f0032773.json` (message records + footer). Timestamps are Unix ms in the JSON; converted above to UTC (`Z`). Local machine clock = UTC+3 (derived from trace epoch ↔ file mtime), so 19:41Z ≈ 22:41 local.
Supporting proof artifact: `…\proofs\surnia-proof-e66d4f92.json` — `provider: openrouter`, `model: nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, `verdict: unproven`, `durationMs: 155451` (~2m35s for a single chat turn).

**Origin in source:**
- `electron/agent/providers.ts:386` — `if (res.status === 429) return new Error('Rate limited (429) — retry shortly.');`
- `electron/agent/providers.ts:385` — `if (res.status === 401) return new Error('Invalid API key (401). Check Settings → AI providers.');`
- `electron/agent/engine.ts:5625` — string classifier `if (l.includes('429')) return 'Rate limited (429) — retry shortly.';`
- `electron/agent/engine.ts:5637` — `401/403 → 'Invalid API key (401/403)…'`
- `src/store.ts:2554`, `:2630`, `:3659` and `electron/services/apiServerService.ts:1167` — insert the `model: 'error'` assistant row the user actually sees.

**Why this matches "no response":** when all retry/failover attempts are 429 or 401, the engine emits one short `model:"error"` chat message plus a `task-report` with `outcome:"error"`, `summary:"Nothing was changed on disk in this run."`, `stopReason:"error"`. In 10 observed sessions (below) there is **no normal assistant answer at all** — only those two rows. This is a provider/quota failure, not an application exception.

---

## 2. Where I looked (and what does / does not exist)

### Real evidence found
| Path | Content | Last write (local, UTC+3) |
|---|---|---|
| `C:\Users\acer\AppData\Roaming\sadeem\logs\main.log` | 85,359 bytes / 550 lines; **56 `[ERROR]`/`[error]` lines** | 2026-11-18 22:55:33 |
| `C:\Users\acer\AppData\Roaming\sadeem\process-logs\bg-*.log` (25 files) | child-process stdout (vite / http.server); **zero error lines** in the two most recent | newest 2026-11-18 07:56:38 |
| `C:\Users\acer\AppData\Roaming\sadeem\sessions\*.json` | persisted chat transcripts with `model:"error"` rows | many on 2026-11-17/18 |
| `C:\Users\acer\AppData\Roaming\sadeem\traces\2026-11-18\*.jsonl` | run traces; all have `footer ok:true` (incl. latest at 19:52:10Z) | 2026-11-18 22:52 |
| `C:\Users\acer\AppData\Roaming\sadeem\proofs\*.json` | proof packages; one `unproven` at 2026-11-18T19:52:10.986Z | 2026-11-18 22:52 |
| `docs\DIAG-LIVE-REPRO.md` (written by another subagent) | contains a real esbuild error from a **local repro attempt** — see §7 | 2026-11-18 23:04:50 |

`logService.ts:56-63, 113-145` confirms `main.log` is written to `<userData>/logs`, rotated at 512 KB, and that every line is redacted before writing. Only `main.log` and `audit.jsonl` exist in that folder — **no rotations**, so no log data was lost to rotation.

### Looked, but no relevant logs
- Repo-wide `Get-ChildItem -Recurse -File | Where-Object {$_.Name -match 'log|error|crash|stderr'}` excluding `node_modules`: only source files with "log/error" in their names (`electron/services/logService.ts`, `src/components/settings/LogsSection.tsx`, `src/components/SurfaceErrorBoundary.tsx`, …), build output in `website/.next/.../_global-error.*`, and `website/.next/cache/turbopack/.../LOG`. The turbopack `LOG` contains no `error/failed` lines (tail is SST compaction only).
- `%USERPROFILE%\.surnia`: only `commands\plugin__sadeem.starter-web__research.md` (295 B). **No logs.**
- `website\.next\server\app\changelog.*` — rendered changelog pages, not logs.
- `checkpoints\...\dev-server.log`, `data\logs\factory.log`, `data\boot-err.log` — old checkpoints from 2026-08-11 / 08-22; not from this wave.
- `Local Storage\leveldb\000003.log`, `Session Storage\000003.log` — Chromium storage files, not readable diagnostic logs.

### Signature counts across `logs` + `process-logs` + `sessions` + `traces` + `proofs`
| Signature | Hits | Verdict |
|---|---|---|
| `Rate limited (429)` | **22** | REAL, in session transcripts (agent-facing) |
| `Invalid API key` | **3** | REAL, in session transcripts |
| `[failover]` | **3** | REAL, in session transcripts |
| React `error #300` / `#185` | 3 / 4 | REAL, in `main.log` renderer |
| `render-process-gone` | 1 | REAL (11-12), crash |
| `CSP` / inline-script refusal | 29 | REAL, recurring every boot |
| `app.asar` | 24 | REAL but **all 2026-11-04/08**, stale launch paths |
| `TypeError` | 1 | **FALSE POSITIVE** — text inside an AI reasoning message about a user's game code |
| `ReferenceError` | 2 | **FALSE POSITIVE** — same, AI reasoning about `pauseOv` TDZ in a game |
| `UNTRUSTED_SENDER` | **0** | **NOT FOUND in any log/artifact** (only exists in source) |
| `watchdog` / `Stream idle watchdog` | **0** | **NOT FOUND in any log/artifact** |
| `agent error` | **0** | NOT FOUND |

---

## 3. Every real error line in `main.log` (timestamp UTC + source)

### 3.1 Current-wave window (2026-11-16 → 2026-11-18) — 24 boot-time CSP blocks + 5 preview aborts

`[ERROR] [renderer] Refused to execute inline script because it violates ... "script-src 'self' surnia:". Either ... ('sha256-aMlgk+AxtOHl8wkoWYyByF32yj50qOFTEdFZcJfZQkc=') ... is required ... (surnia://bundle/index.html?fx=off:6)` — **23 occurrences** at:
`11-16T15:59:50.313Z`; `11-17T05:20:09.646Z`, `06:15:06.367Z`, `14:51:29.525Z`, `15:40:55.511Z`, `17:03:16.494Z`, `17:36:31.789Z`, `17:57:37.992Z`, `18:14:59.833Z`, `18:27:20.291Z`, `18:35:16.990Z`, `18:38:00.467Z`, `18:46:49.833Z`, `19:30:16.684Z`, `19:39:40.440Z`, `20:27:13.157Z`; `11-18T04:47:11.079Z`, `10:22:53.245Z`, `11:37:56.020Z`, `13:09:05.952Z`, `14:49:08.856Z`, `15:14:53.842Z`, `16:50:16.047Z`.
(24th occurrence, older CSP variant: `11-05T21:03:52.433Z`.)

`[ERROR] [renderer] Unexpected error while loading URL Error: Error invoking remote method 'GUEST_VIEW_MANAGER_CALL': Error: ERR_ABORTED (-3) loading 'http://127.0.0.1:4173/' (node:electron/js2c/isolated_bundle:2)` — **5 occurrences**: `11-17T05:38:55.225Z`, `05:42:52.679Z`, `05:55:00.536Z`, `07:13:07.391Z`, `11-18T04:57:38.225Z`. Origin: preview webview loading a user's local static server; `main.log` shows that server was started by the agent (`python -m http.server 4173`).

React renderer fault: `[2026-11-16T04:12:58.979Z] [ERROR] [renderer] Error: Minified React error #300 … (surnia://bundle/assets/index-CXc7tVsb.js:41)` and `[2026-11-17T06:15:04.479Z] … (index-q0RalyqA.js:41)`. React #300 = "Rendered more hooks than during the previous render." No source map for those bundle hashes is present in the repo, so an exact `file:line` in app source cannot be proven from these lines.

### 3.2 Earlier errors in the same log (context, not from the last wave)
| Timestamp (UTC) | Error | Note |
|---|---|---|
| 11-04 19:33:21 → 19:41:25 (8 lines) | `app load failed: ERR_FILE_NOT_FOUND (-6) loading 'file:///D:/Rar$EXa0.*/win-unpacked/resources/app.asar/dist/index.html'` | broken portable unzip paths; stale |
| 11-05 21:03:52.433 | `style-src` invalid source `sha256-3vp6Q0+gIebXRvn0g4u1ZBGFC9iF48inGefx+PVs/FI=` ignored | stale |
| 11-05 21:05:54.920/.921 | `TextModel got disposed before DiffEditorWidget model got reset` (Monaco, `window.onerror` + `Uncaught`) | also 11-15 06:43:42.677/.678 and 08:18:15.429 ×2 |
| 11-08 19:40:50.428/.429 | `Unable to load preload script … app.asar … preload.js`; `Cannot bind an API on top of an existing property on the window object` (`exposeInMainWorld`, preload.js:234) | stale bad-package run |
| 11-10 08:25:02, 08:28:38, 10:55:42, 10:57:10 | React error `#185` (Maximum update depth exceeded) | 4 total |
| 11-10 10:23:26, 11-16 04:12:58, 11-17 06:15:04 | React error `#300` | 3 total |
| 11-12 18:33:08.559 | `render-process-gone: crashed exitCode=-1073741819` (= 0xC0000005 access violation) | real renderer crash |

Normal boot lines bracket every CSP error (`[protocol] surnia:// handler registered`, `[boot] starting SADEEM v11.12.0`, `[load] did-finish-load`), i.e. the blocked inline script does **not** prevent the renderer from loading.

---

## 4. Agent-level error timeline from session artifacts (last 2 days)

Source files: `C:\Users\acer\AppData\Roaming\sadeem\sessions\<id>.json`, field `messages[].timestamp` (Unix ms → UTC). Only rows with `model:"error"` or `task-report outcome:"error"` are listed.

| UTC timestamp | Session | Message |
|---|---|---|
| 11-17T18:25:19Z | 2355a309-… | `Rate limited (429) — retry shortly.` + `task-report outcome:error` |
| 11-17T18:30:14Z | 31543aa8-… | 429 + task-report error |
| 11-17T19:44:04Z | 09b3a0cf-… | 429 + task-report error |
| 11-17T21:09:55Z | f1b81202-… | 429 + task-report error |
| 11-18T05:06:15Z | 72bc8dbf-… | 429 + task-report error |
| 11-18T10:29:02Z | b46b4311-… | 429 + task-report error (`model: openrouter/nvidia/nemotron-3.5-super-vl:free`, 7 recorded retry attempts) |
| 11-18T13:13:18Z | a5aff376-… | 429 + task-report error (same model, 7 attempts) |
| 11-18T15:39:20Z | 0626ed71-… | 429 + task-report error |
| 11-18T15:57:28Z | 0626ed71-… | **`Invalid API key (401/403)`** + task-report error |
| 11-18T16:03:46Z | 0626ed71-… | 429 + task-report error |
| 11-18T16:58:59Z | fe01d304-… | 429 + task-report error |
| 11-18T19:41:37Z | fe01d304-… | **`Invalid API key (401/403)`** + task-report error |
| 11-18T19:44:33Z | fe01d304-… | **`Invalid API key (401/403)`** + task-report error |
| 11-18T19:47:58Z | fe01d304-… | `[failover]` nemotron-3.5-super-vl:free 429 → mistral/codestral-2508 |
| 11-18T19:52:08Z | fe01d304-… | `[failover]` nemotron-3-nano-omni-30b-a3b-reasoning:free 429 → mistral/codestral-2508 |
| 11-18T19:52:11Z | fe01d304-… | task-report **outcome:"completed"** — the run finally answered after failover |

An older session (2026-07, file `sessions/…` containing the shooting-game chat) has multiple `Rate limited (429) — retry shortly.` rows too, confirming the same failure mode is long-standing, not new.

**Negative evidence:** all 12 traces in `traces/2026-11-18/` end with `{"type":"footer","ok":true,...}`; the largest trace (`72bc8dbf…`) records two `task` subagent calls with `ok:true`. So the trace layer shows *no* crashed/aborted run — the failures are recorded in the session messages as provider errors.

---

## 5. Most likely failure chain (evidence-backed)

1. User sends a chat turn. Session model is a **free** OpenRouter model (`nvidia/nemotron-3.5-super-vl:free` or `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`; see session JSON + proof).
2. Provider answers **HTTP 429** (quota) or **401/403** (bad/expired key). `providers.ts:386/385` converts it to a typed Error; `engine.ts:5625/5637` converts it to the exact user-facing strings.
3. The engine retries on the same provider (up to **7 attempts recorded** in the usage ledger of sessions `b46b4311` and `a5aff376`), then fails over (`[failover]`, 3 observed).
4. If all attempts fail, the only assistant output is a `model:"error"` row plus a `task-report` with `outcome:"error"` / `stopReason:"error"` — which the user perceives as "AI not responding / interrupted, no clear reason". `main.log` contains **none of this** because the agent error path writes to the session/trace artifacts, not through `logLine()` — that is why the application log looks almost clean.
5. Independently, every renderer boot is hit by the CSP refusal below, which blocks the `data-kdx-boot` inline script whose purpose (`scripts/post-build.mjs:9`) is to *surface script errors in the UI*. Consequence: even if a renderer error occurs, the app's own visible error-reporting hook has been disabled by Electron's header CSP. This explains "no clear error" on the UI side.
6. Preview/webview navigations abort (`ERR_ABORTED -3`) when the agent's local static server is stopped — cosmetic, not the agent failure.

---

## 6. Exact source origins of the logged errors

| Logged error | Source location |
|---|---|
| `Refused to execute inline script … script-src 'self' surnia:` on `surnia://bundle/index.html?fx=off` | `electron/main.ts:135` defines `RENDERER_CSP` with `script-src 'self' surnia:`; injected as a **response header** at `electron/main.ts:177` (`'content-security-policy': RENDERER_CSP`) on every `surnia://bundle` document. The blocked script is the `data-kdx-boot` inline block generated by `scripts/post-build.mjs:25-35` and hashed at `scripts/post-build.mjs:112-132`. The meta-CSP hash allowlist in `dist/index.html` cannot override the stricter response header — hence the block recurs on every boot. `fx=off` URL assembly: `electron/main.ts:340-356`. |
| `render-process-gone: crashed exitCode=…` | `electron/main.ts:378-379` (`LOG('error','renderer', …)`); note at `electron/main.ts:216` links it to a GPU SharedImageManager issue. |
| `app load failed: ERR_FILE_NOT_FOUND … app.asar/dist/index.html` (old format) | older build's load path; current code serves `surnia://bundle` via `electron/main.ts:151-185`. |
| `Rate limited (429) — retry shortly.` | `electron/agent/providers.ts:386`, classified at `electron/agent/engine.ts:5625` |
| `Invalid API key (401/403)…` | `electron/agent/providers.ts:385`, classified at `electron/agent/engine.ts:5637` |
| `task-report outcome:"error" / stopReason:"error"` | built in `electron/agent/engine.ts` (`emitTaskReport`, ~`:3626`) and persisted by the store; rendered as a `model:"error"` row from `src/store.ts:2554 / 2630 / 3659` |
| `TextModel got disposed before DiffEditorWidget model got reset` | Monaco editor internals (minified vendor bundle); no app source frame in the log |
| `GUEST_VIEW_MANAGER_CALL … ERR_ABORTED` | Electron webview/preview internals (`node:electron/js2c/isolated_bundle`); triggered by `http://127.0.0.1:4173/` preview navigations |
| `UNTRUSTED_SENDER` | **exists in source only**: `electron/main.ts` → compiled `dist-electron/electron/main.js:36607`, `:61395`, `:61473`. **Zero log/artifact hits** — not part of this incident. |

### Silent-catch paths that hide errors (static inspection, supporting §5)
- `electron/agent/engine.ts:3045-3047` — self-critique `catch { /* advisory */ }`, emits no event.
- `electron/agent/engine.ts:3100-3107` — Run & Show failure emits only a `notice`, never a terminal event.
- `electron/services/logService.ts:30-32, 44-46, 108-110, 142-144, 234-236` — multiple `catch { /* best effort */ }` around rotation, audit and streaming writes; logging can silently fail.
- `electron/agent/engine.ts` retry classification at `:5625/:5637` turns HTTP status codes into short strings, so no stack trace or provider response body reaches any log.

---

## 7. Build / version correlation — what is and is NOT from the "last wave"

- `package.json:4` → `"version": "11.12.0"`.
- **Every** boot line says `[boot] starting SADEEM v11.12.0`; every trace header says `"appVersion":"11.12.0"`.
- `dist/` build time: `index.html` 2026-11-18 **19:19:51 local (16:19Z)**, rebuilt **23:05:22 local (20:05Z)**; `src/electron/agent/engine.ts` last modified **23:05:25 local**.
- The v11.13/v11.14 source changes (`engine.ts:3055-3114` Run & Show, `vibeFlow.ts:127-142` self-critique, `prompts.ts:688-690`) landed **after** the installed app logs were produced. Therefore **no runtime evidence exists for those changes** in `main.log`, sessions, traces, or proofs. Any claim that the new Run & Show blocking await caused the reported incident is still only a hypothesis (see `docs/DIAG-ENGINE.md`).
- The 429/401 agent errors **do** continue after the last dist build (19:41Z–19:52Z = 22:41–22:52 local), which is after 16:19Z; they track the *model/provider*, not a new bundle.
- Cross-check on `docs/DIAG-LIVE-REPRO.md`: it records a real esbuild failure `Cannot use "continue" here: electron/agent/engine.ts:3110:14` from a local repro at 23:04:50 local. **This is stale as of 23:05:25** — `engine.ts:3110` is now `} else if (detected) {`, and I re-ran the same esbuild bundle to `D:\ORION\data\cache\tmp\sadeem-diag-logs-engine-check.cjs`: **exit 0, "Done in 531ms"**. No application source was modified; the artifact was only rebuilt to a temp path.

---

## 8. Honest negative findings

1. **No `UNTRUSTED_SENDER`, no watchdog-fire string, no `TypeError`/`ReferenceError` from the app, no `agent error` string in any log or artifact.** Do not build a fix around them on the basis of logs.
2. **No crash dump** (`*.dmp`) or `stderr` file exists in the repo or userData folders inspected.
3. The two `TypeError`/`ReferenceError` grep hits are **AI-generated reasoning text about a separate Three.js game** the user asked the agent to write (e.g. "`geo.parameters` is undefined → TypeError", "`pauseOv` accessed at line 152 but declared at 191 → ReferenceError"). They are not SADEEM runtime exceptions.
4. No provider API key/secret was found in any log — `logService.ts` redaction is working; sessions reference provider *model names* only.
5. I did **not** create `tests/v1114-error-signatures.test.mjs`: a test that asserts machine-specific userData paths or the observed 429 strings would encode environment-specific artifacts rather than prove the bug, and the evidence above does not support a source-level signature test. (Optional deliverable deliberately skipped.)

---

## 9. Fastest way to turn this into a definitive root cause

1. In the UI, check Settings → AI providers for the key used by `openrouter/nvidia/nemotron-3.5-super-vl:free` and `…nemotron-3-nano-omni-30b-a3b-reasoning:free`; a 429/401 there reproduces instantly.
2. Switch the active model to a non-free provider and repeat a chat turn; if the `model:"error"` row disappears, §5 chain #1–4 is confirmed.
3. For the "no clear error on screen" half, capture a renderer screenshot after boot: the inline-script refusal at `electron/main.ts:135/177` should be visible only in DevTools, while `data-kdx-boot` (`scripts/post-build.mjs:9`) is blocked — fixing that CSP/hash mismatch would make future renderer errors visible.
4. For the v11.13/v11.14 hypothesis: bundle and run the **current** engine with a file-writing chat turn and timestamp `sys_notice:run_and_show` → `message_end` → `task_report` → `turn_end`; no existing log covers it.
