# MCP GUARD — v11.38 / F1 verification / تدقيق MCP
**Files / الملفان:** `tests-v1138-mcp-guard.mjs` · `docs/MCP-GUARD-V1138.md`
**Snapshot run / لحظة القياس:** 2026-11-22T07:56:51Z · **Result / النتيجة: 22 PASS / 0 FAIL**
**Raw data / البيانات الخام:** `tests/.v1138-mcp-guard.results.json`

---

## 1. Blunt verdict / الحكم بوضوح

**EN — No. "Every MCP server errors" does NOT reproduce on the current tree.**
A genuine local MCP server (real newline-delimited JSON-RPC 2.0 over stdio) completes
`initialize → tools/list → tools/call` both on the raw wire and through the app's real
`mcpListTools` / `mcpCallTool`. The exact AI tool name `mcp__blender__create_model`
reaches a Blender-like server, a marker file proves the `tools/call` was actually
received, and a real 3D-model result comes back through `executeTool`. A dead server
produces **one** actionable error and **zero** phantom tool defs. Two configured servers
produce defs from **both**, and 40 advertised tools produce **40** defs.

The original root cause recorded in `docs/MCP-TOOLS-V1136.md` (cold-start: a connected
server advertised zero defs on run 1 because `enabledMcp` was seeded only from the sync
last-good cache) is **fixed in this tree**: `electron/agent/engine.ts:2081` awaits the
lossless `connectedServersWithTools()` snapshot *before* `getToolDefs` builds the defs.

**AR — لا. شكوى «كل سيرفرات MCP تعطي خطأ» لا تتكرّر على الشجرة الحالية.**
خادم MCP محلي حقيقي (JSON-RPC 2.0 عبر stdio) يُكمل `initialize → tools/list → tools/call`
سواء على السلك مباشرة أو عبر عميل التطبيق الحقيقي. الاسم الذي يُصدره الذكاء بالضبط
`mcp__blender__create_model` يصل إلى خادم شبيه بـ Blender، وملف علامة يثبت أن
`tools/call` وصل فعلاً، ويعود نتيجة نموذج ثلاثي الأبعاد حقيقية عبر `executeTool`.
الخادم المقطوع يُنتج خطأً واحداً قابلاً للتنفيذ و**صفر** تعريفات أدوات وهمية.
سيرفران مُعدّان يُنتجان تعريفات من **الاثنين**، و40 أداة تُنتج **40** تعريفاً.

السبب الجذري المسجّل في `docs/MCP-TOOLS-V1136.md` (البداية الباردة: سيرفر متصل يعرض
صفر تعريفات في التشغيل الأول) **مُصلح في هذه الشجرة**: `electron/agent/engine.ts:2081`
ينتظر لقطة `connectedServersWithTools()` قبل بناء التعريفات.

> **Scope caveat / تحذير النطاق:** this is a source snapshot guard, written before F1 is
> re-applied. It does NOT exercise a real Blender binary, a real remote HTTP/SSE MCP
> server, or the Electron UI panel. If F1 changes any of these paths, **re-run the guard**
> and require 22/22 again. / هذا فحصsnapshot كُتب قبل إعادة تطبيق F1؛ لا يختبر بلندر
> حقيقياً ولا خادماً عن بُعد ولا واجهة Electron. أعد التشغيل بعد F1 واشترط 22/22 مجدداً.

---

## 2. Method — what is real, what is fake / المنهجية

| Component / العنصر | Status / الحالة |
|---|---|
| MCP transport client `electron/agent/mcp.ts` | **REAL**, esbuild-bundled |
| Def builders `tools.ts` + `tool-defs.ts`, dispatch `executeTool` | **REAL**, esbuild-bundled |
| Registry API `mcpRegistryService.ts` + `storeService.ts` | **REAL**, esbuild-bundled |
| MCP server | **FAKE but genuine protocol**: local child process (`node <fixture>.cjs`) speaking newline-delimited JSON-RPC 2.0; writes marker files on `tools/call` |
| Electron | stub (headless); no `ipcMain.handle` → health monitor disabled during probes |
| Network | **ZERO external net** — all I/O is local child-process stdio + temp files |

Run / التشغيل:
```
node tests-v1138-mcp-guard.mjs          # exit 0 = all PASS
type tests\.v1138-mcp-guard.results.json
```

---

## 3. Results per check — exact file:line / النتائج مع مواضع الأسطر

### Check 1 — connect / list / call on a 3-tool fake server / الاتصال والإدراء والاستدعاء

| ID | Result | Evidence / الدليل | file:line |
|---|---|---|---|
| `1-RAW-INIT` | **PASS** | `initialize` → `serverInfo.name=three-tool-server`, `protocolVersion=2025-11-25` | wire-level (`tests-v1138-mcp-guard.mjs` `rawRoundTrip`) |
| `1-RAW-LIST` | **PASS** | raw `tools/list` returned 3 tools | wire-level |
| `1-RAW-CALL` | **PASS** | raw `tools/call echo` → `CALLED:echo {"value":"raw-wire-v1138"}` | wire-level |
| `1-APP-LIST` | **PASS** | real `mcpListTools` → `echo, list_models, now` (3/3 names) | `electron/agent/mcp.ts:2408` |
| `1-APP-CALL` | **PASS** | real `mcpCallTool(echo)` → `CALLED:echo …`; `markers-1/echo.called` exists | `electron/agent/mcp.ts:2463` |

### Check 2 — "Blender-like" exact-name dispatch / الإرسال بالاسم بالضبط

| ID | Result | Evidence | file:line |
|---|---|---|---|
| `2-DEF` | **PASS** | `getToolDefs` emits `mcp__blender__create_model` (`kind=mcp`, `mcpServerName`, `mcpToolName`, `inputSchema`) | `electron/agent/tools.ts:1353` |
| `2-DEF-PARITY` | **PASS** | canonical `buildMcpToolDefs` schema == runtime def schema | `electron/agent/tool-defs.ts:2517` |
| `2-REAL-DISPATCH` | **PASS** | `executeTool('mcp__blender__create_model', {name:'cell_mitochondrion',format:'glb'})` → `MODEL_3D_CREATED name=cell_mitochondrion format=glb vertices=8 faces=12`; server marker contains the exact args | `electron/agent/tools.ts:8349` |

### Check 3 — disconnected server / السيرفر المقطوع

| ID | Result | Evidence | file:line |
|---|---|---|---|
| `3-PROBE` | **PASS** | 0 connected, 1 surfaced error (not swallowed) | `electron/services/mcpRegistryService.ts:567` |
| `3-HONEST` | **PASS** | single actionable error, `<500` chars, no stack frames, no "I can't" | `electron/agent/mcp.ts:483` |
| `3-NO-PHANTOM` | **PASS** | `connectedMcpToolDefs()` → 0 defs for the dead server | `electron/services/mcpRegistryService.ts:604` |
| `3-CALL-ERROR` | **PASS** | `mcpCallTool(dead)` → `ok:false` + one error string | `electron/agent/mcp.ts:2471` |
| `3-EXEC-VISIBLE` | **PASS** | `executeTool` with a known `mcp__` name and no servers → `ok:false`, non-empty output | `electron/agent/tools.ts:1421` |

Observed error (truncated): `MCP server "Dead Server" (stdio) stopped unexpectedly (exit code 1): '__v1138_no_such_mcp_binary__' is not recognized … check the command/args and server stderr …`.
**Minor wording gap / فجوة صياغة بسيطة:** `3-EXEC-VISIBLE` says `Unknown tool: mcp__…` (with a "did you mean / use exact name" hint) instead of the canonical `mcpDisconnectedError()` ("not connected — reconnect in Settings → MCP") handed off in `docs/MCP-TOOLS-V1136.md:46`. It is honest and visible, but not the ideal phrase. Not a FAIL; tracked here for the tools.ts owner.

### Check 4 — every server, no truncation / كل السيرفرات بلا اقتطاع

| ID | Result | Evidence | file:line |
|---|---|---|---|
| `4-ALL-SERVERS` | **PASS** | 2/2 configured servers connected, 0 errors | `electron/services/mcpRegistryService.ts:580` |
| `4-ALL-DEFS` | **PASS** | defs for **both** servers: `mcp__alpha__{a,b,c}`, `mcp__bravo__{a,b,c}` | `electron/agent/tool-defs.ts:2517` |
| `4-NO-TRUNCATION` | **PASS** | 40 tools → 40 defs, 40 unique names | `electron/agent/tool-defs.ts:2517` |

### Check 5 — source scan of `mcp.ts` / فحص المصدر

| ID | Result | Evidence | file:line |
|---|---|---|---|
| `5-HANDSHAKE` | **PASS** | 4 `call('initialize')` sites + 5 `notifications/initialized` across stdio/http/sse | `electron/agent/mcp.ts:526` |
| `5-PROTOCOL` | **PASS** | `PROTOCOL_VERSION='2025-11-25'`; supported set includes 2025-06-18 / 2025-03-26 / 2024-11-05 | `electron/agent/mcp.ts:76` |
| `5-BOUNDED-RETRY` | **PASS** | `MAX_LIST_PAGES=10`, `HEALTH_MAX_RESTARTS=3`, exactly ONE cold retry, `withTimeout` present, no `while(true)` | `electron/agent/mcp.ts:90` |
| `5-NO-SILENT-CATCH` | **PASS** | 0 empty `catch {}` blocks; 14 `ok:false,error:` paths; `mcpCallTool` surfaces the error; warnings emitted for non-fatal anomalies | `electron/agent/mcp.ts:2471` |

Definition of "silent catch" used by the scan: a `catch` block with a completely empty body
(`/catch\s*(?:\([^)]*\))?\s*\{\s*\}/g`), **plus** the requirement that the public
entry points return an error rather than swallow it. Commented best-effort catches
(e.g. `catch { /* oauth unavailable */ }`) are intentional and are not counted as silent.

### Check 6 (supplementary) — F1 cold-start fix presence / وجود إصلاح F1

| ID | Result | Evidence | file:line |
|---|---|---|---|
| `F1-ENGINE-COLDSTART` | **PASS** | awaited `connectedServersWithTools()` snapshot appears **before** `getToolDefs` in the discovery block; the check rejects a mere import/reference | `electron/agent/engine.ts:2081` |

---

## 4. Re-run after F1 / إعادة التشغيل بعد F1

1. Land F1 (no app source was touched by this guard).
2. `node tests-v1138-mcp-guard.mjs` → require **22 PASS / 0 FAIL** and exit code 0.
3. Compare `tests/.v1138-mcp-guard.results.json` against the table above. Any FAIL
   means F1 regressed a real MCP path; fix F1, not the guard.
4. Do not weaken the assertions to make a FAIL disappear — the guard deliberately
   checks wire behavior and on-disk markers, not just source strings.

---

## 5. Honesty notes / ملاحظات الصدق

- The fake server is a real JSON-RPC peer, but it is not Blender: the 3D-model result
  is a deterministic fixture string (`MODEL_3D_CREATED … vertices=8`). The guard proves
  **dispatch and result relay**, not Blender's modeling correctness.
- Only the **stdio** transport is exercised end-to-end. HTTP/SSE are verified by
  source scan (handshake/protocol/retry) only in this guard.
- The dead-server error is honest but includes a CRLF from Windows `cmd.exe` stderr
  and an occasional doubled period — cosmetic, not a stack or a refusal.
- This is a snapshot: the guard was written against the current tree and must be
  re-run after F1. A past PASS is not a future guarantee.
