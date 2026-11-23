# TECHNICAL RESEARCH — SADEEM v11.13.1
# البحث التقني — سادم 11.13.1

**Topic / الموضوع:** 2026 best practices for an Electron local-first AI coding agent — MCP, Electron hardening, MSIX/Store, SSE resilience, prompt caching & the accuracy contract.
**Research date / تاريخ البحث:** 2026-11-21
**Agent / الباحث:** Research Agent 2 — **web research + read-only source review. I did not edit one line of application source. This document is the only file written.**
**Baseline / المرجع:** SADEEM v11.12.0 tree. Existing audits used as evidence: `docs/SECURITY-FINAL.md`, `docs/MICROSOFT-STORE-READINESS.md`, `docs/SECURITY-AUDIT-v1116.md`.
**Caveat / تحذير:** line numbers are from the tree as read on 2026-11-21. Several UI files were reported as still moving by `SECURITY-FINAL.md:8,93`; re-verify before applying any fix. Findings marked *"not found"* mean **I could not find the control in the files I read** — not a mathematical proof of absence.

---

## 0. ملخص تنفيذي (Arabic)

بصراحة: سادم ليس تطبيقاً أمنياً سيئاً — بل هو تطبيق **جيد جداً في الأماكن التي راجعها الناس، وخطير في الأماكن التي لم يراجعوها بعد**.

أفضل ما فيه: CSP صارم بـ hashes بلا `unsafe-eval`، و`contextIsolation` و`sandbox` مفعّلان، وبروتوكول داخلي `surnia://` بدل `file://`، وماسح أصلي لتسميم أدوات MCP، وتوقيعات PKCE وحالة OAuth، و**عقد دقة مكتوب صراحةً** (`prompts.ts:483`) يمنع التخمين ويطلب دليلاً من نوع `file:line`. هذا يتفوق على كثير من عملاء MCP التجاريين.

لكن القائمة الحمراء طويلة:

1. **إصدار Electron 33.4.11** (`package.json:36,61`) عمره حوالي سنتين في نوفمبر 2026 — أي يخالف صريحاً توصية Electron رقم 16 "استخدم إصداراً حديثاً". هذه أكبر ثغرة صامتة في المشروع لأنها تضعف كل طبقة أخرى.
2. **سطح IPC غير المحمي** ما زال واسعاً (`kdx:agent:run` وغيره) — موثّق كـ P1-3 في `SECURITY-FINAL.md:80-89`.
3. **MCP يتحدث نسخة 2025-06-18** (`mcp.ts:73-79`) بينما المواصفة الحالية 2025-11-25. غابت آليات مهمة: `resource` parameter (RFC 8707)، وProtected Resource Metadata (RFC 9728)، والتحقق من `code_challenge_methods_supported`، و`Last-Event-ID`، و`CancelledNotification`، وإعادة التهيئة بعد HTTP 404.
4. **عنوان OAuth يفتح بلا التحقق من المخطط** — `new URL(...)` ثم `shell.openExternal` (`mcpOAuth.ts:286-297`)؛ رابط `javascript:` أو `file:` من خادم MCP خبيث هو ثغرة XSS/RCE محتملة حسب دليل أمان MCP.)
5. **لا تثبيت للتحقق من تجزئة تعريف الأداة** — الماسح يعيد الفحص عند `list_changed` لكنه لا يعيد طلب الموافقة (`mcp.ts:2467-2478`)، أي أن هجوم "rug pull" ما زال ممكناً.
6. **حزمة المتجر**: لا بروتوكول `sadeem://` في الـ manifest، ولا هوية ناشر، ولا سياسة خصوصية، والمُحدِّث الذاتي لا يعمل مع حزمة المتجر (`MICROSOFT-STORE-READINESS.md`).
7. **عقد الدقة يتناقض مع أفضل ممارسات 2026**: `prompts.ts:457` يمنع صراحةً قول "لا أستطيع"، بينما توصي الأبحاث بـ abstention صريح عند عدم التيقن. هذا قرار منتج، لكن يجب توثيقه كخطر معروف.
8. **التوقيع ما زال معطّلاً** (`electron-builder.yml:29-80`) — عائق إطلاق معروف.

الحكم: **لا تُطلق الآن، ولا تقل "جاهز للمتجر"**. لكن الأساس متين، ومعظم الفجوات أدناه قابلة للإغلاق بأعمال محدودة.

---

## 0. Executive summary (English)

Blunt verdict: SADEEM is **not a badly built app — it is a well-hardened app in places people reviewed, and a dangerous app in places nobody reviewed yet.**

Genuinely strong: strict hashed CSP with no `unsafe-eval` (`electron/main.ts:122-193`), `contextIsolation: true` + `nodeIntegration: false` + `sandbox: true` (`main.ts:313-322`), a custom `surnia://` internal scheme instead of `file://` (`main.ts:91-96,195-233`), a home-grown MCP tool-poisoning scanner (`agent/mcp.ts:2329-2371`), PKCE S256 + constant-time state verification + encrypted token storage (`agent/mcpOAuth.ts:62-105,232-246`), and an **explicit written accuracy contract** at `agent/prompts.ts:483`. This is better than many commercial MCP clients.

Red flags, ranked by my assessment:

1. **Electron 33.4.11** (`package.json:36,61`) is roughly two years old in Nov 2026 and directly contradicts Electron's own security checklist item 16 ("use a current version"). This silently weakens every other layer.
2. **Wide ungated IPC surface** including `kdx:agent:run` — already a launch blocker P1-3 in `SECURITY-FINAL.md:80-89`.
3. **MCP protocol version 2025-06-18** (`agent/mcp.ts:73-79`) vs current spec **2025-11-25**. Missing: RFC 8707 `resource`, RFC 9728 Protected Resource Metadata, PKCE-capability verification, `Last-Event-ID` resumption, `CancelledNotification`, 404→reinitialize.
4. **Unvalidated OAuth URL scheme** — `new URL(...)` then injected `shell.openExternal` (`mcpOAuth.ts:286-297`); a `javascript:`/`file:` authorization endpoint from a malicious MCP server is a plausible XSS→RCE path per the MCP security best-practices doc.
5. **No tool-definition hash pinning** — the scanner re-probes on `list_changed` but never re-asks approval (`mcp.ts:2467-2478`), so classic rug-pull remains open.
6. **Store package is a scaffold, not a submission** — no `sadeem://` protocol extension in the APPX manifest, placeholder identity/publisher, no hosted privacy policy, self-updater wrongly active in a Store build.
7. **Accuracy contract conflicts with 2026 abstention guidance** — `prompts.ts:457` explicitly forbids "I can't"; research recommends calibrated abstention. Deliberate product trade-off, but it must be named as a risk.
8. Unsigned binaries remain a known launch blocker (`electron-builder.yml:29-80`).

**Status legend used below:** ✅ HANDLED · ⚠️ PARTIAL · ❌ GAP · ❓ NOT FOUND (in files I read).

---

# PART II — ENGLISH TECHNICAL DETAIL

## 1. MCP — current transport & security guidance

**Authoritative sources used**
- MCP spec 2025-11-25 — Transports: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP spec 2025-11-25 — Authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP spec 2025-11-25 — Security Best Practices: https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices
- Invariant Labs, Tool Poisoning Attacks (2025-04-01): https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks
- Elastic Security Labs, MCP Tools attack vectors (2025-09-19): https://www.elastic.co/security-labs/threat-command/mcp-tools-attack-defense-recommendations
- Microsoft Zero Trust catalog, Rug-Pull Attack (2026-07-28): https://learn.microsoft.com/en-us/security/zero-trust/catalog-ai-attack-techniques/rug-pull-attack

> Note: the 2025-06-18 URL redirected to the **2025-11-25** spec — that is the current revision as of this research. SADEEM still speaks 2025-06-18.

### 1.1 Actionable recommendations

| # | Recommendation (source) | SADEEM status | Evidence |
|---|---|---|---|
| M1 | Support the current protocol revision in `initialize` negotiation and send `MCP-Protocol-Version` on every post-init HTTP request (Transports §Protocol Version Header). | ⚠️ PARTIAL — header sent, version list frozen at 2025-06-18 | `electron/agent/mcp.ts:27-29` (header), `mcp.ts:73-79` (`PROTOCOL_VERSION='2025-06-18'`, `SUPPORTED_PROTOCOL_VERSIONS` = 2025-06-18 / 2025-03-26 / 2024-11-05). 2025-11-25 absent. |
| M2 | For Streamable HTTP: clients **MUST** echo `MCP-Session-Id`, and on HTTP 404 in response to a request carrying it **MUST** start a new session with a fresh `InitializeRequest` (Transports §Session Management). | ⚠️ PARTIAL — echo yes, 404-reinit not found | `mcp.ts:700` (header), `mcp.ts:737` (capture), `mcp.ts:814` (drop on teardown). `httpErr()` at `mcp.ts:159-168` turns 404 into a *hint string* (`mcp.ts:164`) rather than a reinitialize path. ❓ No re-init found. |
| M3 | **Validate OAuth authorization URLs before opening them:** allow only `http(s)` (http only for loopback); reject `javascript:`, `data:`, `file:`, `vbscript:`; never use a shell to open URLs (Security Best Practices §OAuth Authorization URL Validation). | ❌ GAP — high severity | `electron/agent/mcpOAuth.ts:286-297`: `new URL(meta.authorizationEndpoint)` → set params → `opts.openUrl(authUrl.toString())` where `openUrl` is injected `shell.openExternal` (`ipc.ts:851-859`). No scheme allowlist anywhere in the flow. |
| M4 | Implement RFC 8707 `resource` parameter in **both** authorization and token requests; bind tokens to the MCP server audience (Authorization §Resource Parameter Implementation, §Token Audience Binding). | ❌ GAP | `mcpOAuth.ts:286-295` (auth URL) and `:317-324` (token form body) contain no `resource=`. `issuer` is stored only for display at `:337`. |
| M5 | Discover authorization servers via **RFC 9728 Protected Resource Metadata** (`WWW-Authenticate: resource_metadata=…`, then well-known), and try both RFC 8414 and OIDC discovery in the spec's priority order (Authorization §Authorization Server Discovery). | ❌ GAP | `mcpOAuth.ts:159-186` tries exactly two RFC-8414 paths at the MCP server origin. No `WWW-Authenticate` parsing, no `/.well-known/oauth-protected-resource`, no OIDC (`openid-configuration`) candidates. |
| M6 | Verify PKCE support from AS metadata (`code_challenge_methods_supported`); **refuse to proceed if absent**. Use S256 and `state` (Authorization §Authorization Code Protection). | ⚠️ PARTIAL — PKCE/state good, capability check missing | ✅ `mcpOAuth.ts:242-246` (S256), `:280-292`, `:232-240` (constant-time state), `:360-375`. `AuthServerMeta` at `:148-153` has no `codeChallengeMethodsSupported` field → no verification/refusal. |
| M7 | Least-privilege scope selection: use the `scope` from the initial `WWW-Authenticate` challenge; handle runtime `403 insufficient_scope` with a bounded step-up flow (Authorization §Scope Selection / §Scope Challenge Handling). | ❌ GAP | `mcpOAuth.ts:293-295` uses `opts.scopes ?? meta.scopes_supported` sliced to 12. `ipc.ts` 403 handling is just a text hint at `mcp.ts:163`. No step-up, no attempt tracking. |
| M8 | Guard OAuth metadata discovery against SSRF: enforce HTTPS, block private/link-local ranges (`169.254.0.0/16`, `127/8`, `10/8`, `172.16/12`, `192.168/16`, `fc00::/7`), validate redirects, avoid DNS TOCTOU (Security Best Practices §SSRF). | ❌ GAP | `mcpOAuth.ts:115-136` is a bare `fetch(url)` with a 15s timeout. Discovery URLs come from the MCP server (`:166-179`) — a malicious server can point them at cloud metadata. Same class as the already-known P2-1 DNS TOCTOU in `tools.ts:3955-3973`. |
| M9 | Tool poisoning / rug pull: pin tool-definition hashes and **re-ask approval when a definition changes**; show the full description in the UI; vet cross-server shadowing (Invariant; Elastic; Microsoft). | ⚠️ PARTIAL — scanner strong, pinning absent | ✅ 9 regex rules + auto-quarantine `mcp.ts:2341-2366`, `:2453-2461`; annotations `:1638-1699`; destructive-call approval + elicitation `:1188-1310`; name-collision guard `:1727`. ❌ `onToolsListChanged()` at `:2467-2478` only clears the annotation cache and re-probes — no hash compare, no re-approval. Regex also misses zero-width/Unicode smuggling and Base64 <200 chars. |
| M10 | Local MCP servers are arbitrary code: show the **exact command** before one-click config, sandbox the spawned process, prefer stdio restricted to the client (Security Best Practices §Local MCP Server Compromise). | ❓ NOT FOUND / ⚠️ PARTIAL | `mcp.ts:284-297` pins `${workspace}` for cwd/args; stdio children are pooled and closed at shutdown (`main.ts:933-937`). No sandbox of spawned servers found in `mcp.ts`; I did not read the settings UI, so the consent-dialog claim needs manual verification. |
| M11 | Streamable HTTP: prime SSE with an event ID + empty data, emit `retry`, honour `Last-Event-ID` on GET resume, send `CancelledNotification` to cancel (Transports §Resumability, §Sending Messages). | ⚠️ PARTIAL — parsing only | ✅ `SseParser` `mcp.ts:656-679`, SSE-body JSON-RPC extraction `:248-260`, keepalive comments `:669`. ❓ No `Last-Event-ID`, no `retry` handling, no `CancelledNotification` found in `mcp.ts` (grep). |

### 1.2 Honest assessment

The MCP layer is **the most mature part of this codebase**. The anti-poisoning scanner, deterministic tool ordering, config fingerprinting for pooled clients (`mcp.ts:1364-1372`), and the refusal to retry a `tools/call` that may already have executed (`mcp.ts:129-151,769-771,916`) are genuinely good engineering — the latter is exactly the idempotency rule the SSE research below also demands.

But it is built against a **spec revision that is now a year behind**, and its OAuth client implements the *2025-03-26-era* flow (RFC 8414 + dynamic registration) without the 2025-11-25 additions. M3 and M4 are not cosmetic: an unvalidated authorization URL combined with `shell.openExternal` is a real escalation path, and a missing `resource` parameter means tokens are not audience-bound.

**Concrete fix order:** M3 → M4/M5 → M8 → M6/M7 → M9 → M1/M2/M11.

---

## 2. Electron security hardening

**Authoritative source:** Electron Security Checklist — https://www.electronjs.org/docs/latest/tutorial/security ; IPC guide — https://www.electronjs.org/docs/latest/tutorial/ipc

### 2.1 Actionable recommendations

| # | Recommendation (Electron checklist item) | SADEEM status | Evidence |
|---|---|---|---|
| E1 | Enable context isolation in all renderers (#3); do not enable Node integration (#2); enable process sandboxing (#4). | ✅ HANDLED | `electron/main.ts:313-322`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (v7.2 fix). Guest webviews also forced off/on at `main.ts:701-718`. |
| E2 | Define a restrictive CSP (#7); do not disable `webSecurity` (#6); no `allowRunningInsecureContent` (#8). | ✅ HANDLED | `main.ts:122-193`: strict policy on every `surnia://` response; hashed scripts from `dist/csp-hashes.json` sidecar (`:141-168`); `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'none'` (`:189-192`); `wasm-unsafe-eval` is WebAssembly-only and deliberately kept off the eval line (`:164-168`); `webSecurity` left ON (`main.ts:89`). ⚠️ `style-src 'unsafe-inline'` is intentional (`:124-126`). |
| E3 | Prefer custom protocols over `file://` (#18); avoid exposing raw Electron APIs through `contextBridge` (#20). | ✅ HANDLED | `main.ts:91-96` privileged `surnia` scheme, served at `:195-233`; renderer loaded from `surnia://bundle/index.html`. Preload exposes named invoke wrappers (`electron/preload.ts:148-155`), not raw `ipcRenderer`. |
| E4 | Validate the sender of **all** IPC messages (#17); limit navigation (#13) and new windows (#14); do not pass untrusted content to `shell.openExternal` (#15); use a permission handler (#5). | ⚠️ PARTIAL — the biggest Electron gap | ✅ `ipc.ts:331-336` `isTrustedRenderer()` reads **only** `senderFrame.url`; 28 `handleTrusted` registrations `ipc.ts:378-834` (+ inline gate `:450`). ❌ Many high-impact channels remain ungated — **`kdx:agent:run` at `electron/agent/register.ts:234`** (registered with plain `ipcMain` at `main.ts:891`), `pluginService.ts:363` (installUrl), `updateService.ts:111` (setFeedUrl), `ipc.ts:724-727` (auth), `:768-774` (schedule), `main.ts:627,642,670,686`. See `SECURITY-FINAL.md:80-89` (launch blocker **P1-3**). ✅ Window/permission handlers at `main.ts:707-732`. |
| E5 | Validate deep-link scheme and format; use a single-instance/second-instance handler. | ✅ HANDLED at runtime, ❌ GAP in the Store package | Regex `^sadeem://auth/callback?...` at `main.ts:769`; second-instance + open-url `:811-820`; `setAsDefaultProtocolClient('sadeem')` `:824-836`; pair code has 15-min TTL, one-use, local-account guard (`authService.ts:384-461`; `SECURITY-FINAL.md:30`). ❌ No `<uap:Protocol>` in the generated APPX manifest — see §3. |
| E6 | **Use a current version of Electron** (#16). | ❌ GAP — my highest-priority silent finding | `package.json:36,61`: `electron ^33.4.11` and `allowScripts` pin `electron@33.4.11`. Electron 33 shipped in the 2024 release line; as of 2026-11 that is ~2 years of unpatched Chromium/Node CVEs. Electron's own doc says this "ensures critical vulnerabilities are already patched". Electron checklist #16. |
| E7 | Check which **fuses** can be flipped (#19) — e.g. disable `runAsNode`, `nodeCliInspect`. | ❓ NOT FOUND | `@electron/fuses` appears only as a transitive dep of `app-builder-lib` (`node_modules/app-builder-lib/package.json:51`); no app-level fuse config in `package.json` scripts or build files I read. electron-builder v26 may do some of this by default — verify, don't assume. |

### 2.2 Brutal note

The Electron work here is *visibly* security-conscious — someone read the checklist. The two things that undercut it are the ones that are easy to forget after launch: **the framework version** and **the channels added later by other agents**. A perfect CSP does not help if `kdx:agent:run` will execute for any frame that can reach the bridge, and a 2024 Chromium does not become safe because the CSP is good. Fix E6 and P1-3 before anything else in this section.

---

## 3. Microsoft Store / MSIX requirements

**Authoritative sources**
- MSIX overview — https://learn.microsoft.com/en-us/windows/msix/overview
- Microsoft Store Policies v7.20 (published 2026-09-15, effective 2026-10-22) — https://learn.microsoft.com/en-us/windows/uwp/publish/store-policies
- Repo's own audit: `docs/MICROSOFT-STORE-READINESS.md` (2026-11-20) — I independently confirm its core claims against the source tree.

### 3.1 Actionable recommendations

| # | Recommendation | SADEEM status | Evidence |
|---|---|---|---|
| S1 | MSIX gives **package identity**; all MSIX packages **must be signed** before installation, and AppxManifest declares identity/capabilities/extensions (MSIX overview). | ⚠️ PARTIAL — scaffold only | `build/store/appx/appxmanifest.xml`, 8 logos in `build/store/logos/`, `electron-builder.yml:95-137`, scripts at `package.json:48-50` (real work, credit due). ❌ identity/publisher are sentinels `REPLACE_WITH_STORE_IDENTITY_NAME` / `CN=REPLACE_WITH_STORE_PUBLISHER_CN` (`electron-builder.yml:123-124`); all signing lines commented (`:29-80`); `scripts/store-preflight.mjs:43-67` correctly refuses placeholders. |
| S2 | A packaged app must declare the protocol in the manifest (`<uap:Extension Category="windows.protocol">`). Runtime `setAsDefaultProtocolClient` is **not** a substitute for packaged apps. | ❌ GAP — functional bug | `electron-builder.yml` has **no `protocols` key**, so `${extensions}` at `build/store/appx/appxmanifest.xml:71` expands to empty. Code needs `sadeem` (`main.ts:769,824-836`), not internal `surnia` (`main.ts:91-96`). `sadeem://auth/callback` will be **dead** in the Store build. Fix: `protocols: [{ schemes: [sadeem], name: "SADEEM authentication callback" }]`. See `MICROSOFT-STORE-READINESS.md:85-96,165-176`. |
| S3 | Store policy 10.5.1: every Desktop Bridge/Win32 product needs a real, hosted privacy policy URL entered in Partner Center. | ❌ GAP | Only prose at `website/app/docs/page.tsx:291-319`, which also contradicts the app (claims no account DB while `main.ts:793` creates one). Fake support email `sadeem@app.local` (`package.json:10`). |
| S4 | Store-managed updates (10.2.5), or a silent signed installer (10.2.9). An `electron-updater` `quitAndInstall()` against an external feed cannot replace a Store-signed package. | ❌ GAP | `updateService.ts:25-28` feed, `:128-172` IPC + scheduled check; three conflicting domains (`updateService.ts:27`, `website/lib/site.ts:8,27`); NSIS is interactive (`electron-builder.yml:85-87`). Must gate self-update when package identity is present. |
| S5 | Declare capabilities that genuinely relate to function (10.6) and disclose them + third-party dependencies in certification notes (10.2.4). | ⚠️ PARTIAL | `internetClient` + `runFullTrust` present in the manifest template (`build/store/appx/appxmanifest.xml:52-55`) — correct classes — but undocumented/untested on a real MSIX; `runFullTrust` needs justification (terminal spawn, arbitrary workspace FS, loopback server). |
| S6 | Certification notes + WACK validation before submission. | ❌ GAP | No WACK run exists; no certification-notes draft; `MICROSOFT-STORE-READINESS.md:198-221` lists the nine Partner-Center-only actions. |
| S7 | **MSIX containerization** virtualizes/redirects filesystem and registry writes (MSIX overview, "Containerized execution"). A full-trust Electron agent that writes workspace files and a `userData` store must be **tested inside the container**, not assumed to work. | ❌ GAP — new from this research | Confine root + userData pinned at `electron/main.ts:53-56,850-853`; writes throughout `main.ts` and `fsService.ts:118-197`. No MSIX-container test found. Add a WACK/MSIX smoke test that writes outside the package dir and verifies the real path. |
| S8 | Do not trust a green preflight as proof of signing; only real `WIN_CSC_LINK`/`CSC_LINK`+password (or a verified custom hook) counts. | ⚠️ PARTIAL — gate defect | `scripts/store-preflight.mjs:70-96` accepts `STORE_CERT_SUBJECT` / bare `AZURE_*` vars that electron-builder v26 has no native consumer for (`electron-builder.yml:65-69` admits a custom hook is needed). A green PASS can still ship unsigned. Also `BadgeLogo.png` is 142 bytes — verify visually. |

**Verdict:** everything in `MICROSOFT-STORE-READINESS.md` still stands. The addendum from current Microsoft docs is **S7** (containerization) — a functional risk that the earlier audit did not call out.

---

## 4. Streaming SSE resilience (reconnect + idempotent tool calls)

**Authoritative sources**
- MCP Streamable HTTP resumability/redelivery — https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MDN, Using server-sent events (`id`, `retry`, `Last-Event-ID`, auto-reconnect, 6-connection HTTP/1.1 limit) — https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- Ably, Resume tokens and last-event IDs (2026-03-12) — https://ably.com/blog/resume-tokens-last-event-id-llm-streaming-reconnection
- MidyTech runbook, Last-Event-ID + idempotency tests (2026-12-11) — https://www.midytech.com/ai-chat-sse-last-event-id-reconnect-idempotency-runbook/
- Microsoft Foundry, stream with reconnect (`starting_after` cursor, snapshot reset) — https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/stream-with-reconnect

### 4.1 Actionable recommendations

| # | Recommendation | SADEEM status | Evidence |
|---|---|---|---|
| R1 | Separate **conversation_id / generation_id / event_id**. A reconnect is a transport event, never permission to start a second generation; use an idempotency key and return the existing job on an equivalent retry (MidyTech). | ❌ GAP for LLM streams | `src/store.ts:1831-1837,2606-2607,3230-3239` has a `resumableRun` localStorage marker offering **one-click re-run** after a crash — that is a *new* generation with a checkpoint, not stream replay. No `generation_id`/idempotency key found. |
| R2 | Use monotonically increasing per-generation sequence numbers; store payload + sequence atomically; replay from `Last-Event-ID`; include explicit `completed`/`failed`/`cancelled` terminal states; do not infer rendering from send (MidyTech; MCP spec; MDN). | ❌ GAP | `mcp.ts:656-679` parser and `providers.ts:1488-1509` stream drop detection exist, but no event IDs, no replay buffer, no terminal-state contract found. |
| R3 | Bound the replay window (TTL + max event count) and return a structured **"resume unavailable"** with a link to the finalized answer — never silently start a second generation (MidyTech). | ❌ GAP | Not found. |
| R4 | **Recheck authorization on every reconnect** (user may have signed out / changed workspace); limit concurrent streams per user to prevent reconnect amplification (MidyTech). | ❌ GAP | Not found in the stream paths. Note the local-app threat model is lower than a multi-tenant web app, but token/workspace revalidation still matters for remote MCP. |
| R5 | Deduplicate by `generation_id` + `event_id` in the renderer; failure-injection matrix (drop after first token, at UTF-8 boundary, before terminal, after deploy, duplicate POST, expired cursor); track disconnects/resume rate/duplicate jobs (MidyTech; Ably). | ❌ GAP | No dedupe or reliability metrics found. |
| R6 | **Idempotent tool calls:** never retry a call that may already have executed; retry only transient transport failures; use an explicit cancellation signal (`CancelledNotification`) rather than treating a disconnect as cancel. | ✅ HANDLED (MCP tools), ⚠️ PARTIAL (cancellation) | Strong: `mcp.ts:129-151` `McpTransportError.retryable`, `:526`, `:537`, `:769-771` (5xx on `tools/call` never retried), `:916`. ❓ No `CancelledNotification` sender found (grep). |
| R7 | For provider streams: choose a replay backing with a cursor and a **per-turn stream ID**; treat a repeated `response.in_progress` as a **snapshot reset** (replace local output, then apply additive events) (Microsoft Foundry). | ⚠️ PARTIAL | `providers.ts:1479-1509` accumulates SSE events with `outChars`/`answerText` and tracks `streamDropErr`; engine has stall recovery and completion reporting (`package.json:5`). No cursor/snapshot-reset protocol found. |
| R8 | Respect `retry:` reconnect delay; use keepalive comments; be aware of the 6-connection-per-domain HTTP/1.1 SSE ceiling (MDN). | ⚠️ PARTIAL | Keepalive comments skipped correctly at `mcp.ts:669` (`line.startsWith(':')`). `retry:` handling not found. SADEEM uses `fetch`-based parsing, so MDN's automatic `EventSource` reconnect does **not** apply — reconnection must be built. |

### 4.2 Honest assessment

The **tool-call idempotency rule is already right** — SADEEM's developers understood that a dropped response is not proof the tool did not run. That is the hardest and most important part, and it is done.

What is missing is the *stream* half: no event IDs, no replay window, no resume cursor, no dedupe, no authorization recheck. For a local-first desktop agent the blast radius is mostly "user sees a duplicated or truncated answer", not a multi-tenant leak — but with long-running agent turns and multiple MCP SSE streams, this is exactly where "everything works, nothing hangs" will be tested. R1–R3 are the highest value; R4–R5 can follow.

---

## 5. Prompt caching & the accuracy contract

**Authoritative sources**
- Anthropic Prompt caching (current docs, auto + explicit breakpoints, TTL, invalidation, diagnostics) — https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Agentic Abstention (arXiv 2606.28733) — https://arxiv.org/abs/2606.28733
- Confidence/abstention gate patterns — https://fp8.co/articles/AI-Agent-Abstention-When-Not-to-Guess ; https://agentgrading.ai/guides/how-to-measure-rag-groundedness ; https://virillio.com/blog/agent-abstention-contract

### 5.1 Prompt caching — actionable recommendations

| # | Recommendation | SADEEM status | Evidence |
|---|---|---|---|
| C1 | Place `cache_control` on the **last byte-identical block** of the stable prefix; keep volatile content (clock, memory, context) in a separate block after the breakpoint (Anthropic "Common mistake"). | ✅ HANDLED — explicitly designed for | `providers.ts:1406-1416` `splitSystemPrompt()` — stable system block gets the breakpoint, dynamic tail is a separate block (v11.16 fix). Comment at `:1396-1402` documents the 4-breakpoint limit; 3 are used (system, last tool, rolling last message). |
| C2 | Use automatic caching / rolling breakpoints for growing multi-turn conversations; keep ≤4 breakpoints and stay inside the 20-block lookback window. | ✅ HANDLED (rolling breakpoint) | `providers.ts:1375-1391` `applyRollingCacheBreakpoint()` marks the last message block each turn. ⚠️ Verify the last block is not a per-request volatile value — if it is, the cache will never hit (Anthropic's exact warning). |
| C3 | Track `cache_creation_input_tokens` / `cache_read_input_tokens` and analyze hit rate; use cache diagnostics when consecutive requests diverge. | ⚠️ PARTIAL — accounting yes, hit-rate no | ✅ `providers.ts:1480-1483,1495` parses usage; `costs.ts:353-372` prices cache reads/writes; `engine.ts:2939,4056,4410-4424,5005` aggregates per run. ❓ No hit-rate metric or `cache-diagnostics` integration found. |
| C4 | Provide a 1-hour TTL (`ttl: "1h"`) for prompts used less often than every 5 minutes. | ❌ GAP | All breakpoints use `{ type: 'ephemeral' }` (`providers.ts:1389,1413,1431`) — no TTL option surfaced in settings. |
| C5 | Strip `cache_control` gracefully for gateways that reject it; respect per-model minimum cacheable token thresholds. | ⚠️ PARTIAL | ✅ 400-downgrade at `providers.ts:1468-1475` + `stripCacheControl()` `:1030-1036`. ❓ Minimum-token enforcement not found (Anthropic: 512 tokens on newer models, up to 4096 on older ones — below that, caching silently does nothing). |

### 5.2 The accuracy contract — actionable recommendations

Important finding: **"accuracy contract" is SADEEM's own term**, not generic industry jargon. It already exists at `electron/agent/prompts.ts:483` as `# ACCURACY CONTRACT (verify, not guess)`.

| # | Recommendation | SADEEM status | Evidence |
|---|---|---|---|
| A1 | Make accuracy an explicit, testable contract: verify with tools, cite evidence (`file:line`), never invent findings, ground web claims in fetched source URLs. | ✅ HANDLED — a differentiator | `prompts.ts:483-484` ("verify, never guess"), `:201` (review findings with `file:line`; "never invent problems"), `:575` (reproduce → hypotheses → verify → fix → re-run; failing test first), `:662-671` (write→verify loops; "never claim success without evidence"), `:731` (browse mandatorily for current/external facts, cite source URL), `:623` ("never answer from memory what a tool can verify"). |
| A2 | Add a calibrated **abstention gate**: when evidence is thin or the goal is unachievable, stop tool calls and say so with the specific blocker, instead of guessing. | ❌ GAP — and partly contradicted | `prompts.ts:457` explicitly says `NEVER say "I can't / I don't have the tools / I'm unable"` and `:459` says "zero capability disclaimers". That is the *opposite* of abstention. Research (`Agentic Abstention`, confidence-gate guides) recommends a bounded "I don't know / here is the exact blocker" state. This is a deliberate product choice ("harness auto-continues"), but it should be documented as a known accuracy risk rather than left implicit. |
| A3 | Emit structured confidence/grounding metadata (which tool result supports which claim) and gate it in CI; measure groundedness on a fixed eval set. | ❌ GAP | No structured confidence/citation field found in agent events; `docs/` has many `file:line` audit reports (human-authored), which is good practice but not an automated agent-output gate. |
| A4 | Keep prompt text **word-stable** for cache hits while still evolving the contract. | ✅ HANDLED | `prompts.ts:662` comment: "long-task + verify-before-done (word-stable for the prompt cache)". Nice coupling of the two themes. |

### 5.3 Honest assessment

Prompt caching here is **better implemented than in most agents I see in the wild** — the stable/dynamic system split and the explicit "don't add breakpoints casually" comment show real understanding of Anthropic's invalidation rules. The only real gap is observability (hit rate, cache diagnostics) and the missing 1-hour TTL.

The accuracy contract is the project's intellectual high point, but it has a blind spot: it optimizes for *never stopping*, whereas 2026 research optimizes for *knowing when to stop*. Both are defensible for a coding agent (auto-continuation avoids useless refusals), but the honest label is "optimistic contract with no abstention path", not "fully accurate contract".

---

## 6. Consolidated gap register (ranked, with file:line)

| Rank | Gap | Severity | Location | Source of requirement |
|---|---|---|---|---|
| 1 | Electron 33.4.11 is ~2 years old | **Critical (silent)** | `package.json:36,61` | Electron checklist #16 |
| 2 | Ungated IPC incl. `kdx:agent:run`, plugins, updater, auth, schedule | **Blocker** (existing P1-3) | `agent/register.ts:234`; `main.ts:891`; `pluginService.ts:363`; `updateService.ts:111`; `ipc.ts:724-727,768-774` | Electron checklist #17 |
| 3 | OAuth authorization URL scheme unvalidated before `shell.openExternal` | **High** | `mcpOAuth.ts:286-297` (`openUrl` injected at `ipc.ts:851-859`) | MCP Security Best Practices §OAuth URL Validation |
| 4 | SSRF in OAuth metadata discovery (no HTTPS/private-IP block) | **High** | `mcpOAuth.ts:115-136,159-186` | MCP Security Best Practices §SSRF |
| 5 | No RFC 8707 `resource`; no RFC 9728 Protected Resource Metadata; no PKCE-capability check; no step-up scopes | **High** | `mcpOAuth.ts:148-153,159-186,286-324` | MCP Authorization 2025-11-25 |
| 6 | No tool-definition hash pinning / re-approval on `list_changed` (rug pull) | **High** | `mcp.ts:2467-2478` | Invariant / Elastic / Microsoft rug-pull guidance |
| 7 | Store APPX has no `sadeem://` protocol extension | **Blocker** (functional) | `electron-builder.yml` (no `protocols`); `build/store/appx/appxmanifest.xml:71` | `MICROSOFT-STORE-READINESS.md:165-176` |
| 8 | Store identity/publisher placeholders + no signing; preflight false-PASS | **Blocker** | `electron-builder.yml:29-80,123-124`; `scripts/store-preflight.mjs:70-96` | MSIX overview / Store policy 10.2 |
| 9 | No privacy policy URL; self-updater active in Store build; 3 feed domains | **Blocker** | `website/app/docs/page.tsx:291-319`; `updateService.ts:25-28,128-172`; `website/lib/site.ts:8,27` | Store policies 10.5.1 / 10.2.5 |
| 10 | No SSE replay/idempotency key/generation ID/dedupe/authorization recheck | **Medium** | `mcp.ts:656-679`; `providers.ts:1479-1509`; `src/store.ts:1831-1837,3230-3239` | MCP transports; MidyTech; Foundry |
| 11 | No `Last-Event-ID`, `retry`, or `CancelledNotification` on MCP HTTP streams | **Medium** | `mcp.ts` (not found) | MCP transports §Resumability |
| 12 | No 404→reinitialize for `MCP-Session-Id` | **Medium** | `mcp.ts:159-168,700,737,814` | MCP transports §Session Management |
| 13 | No 1-hour cache TTL; no cache hit-rate/diagnostics | **Low-Medium** | `providers.ts:1389,1413,1431`; `costs.ts:353-372` | Anthropic prompt caching |
| 14 | No abstention gate; contract explicitly forbids "I can't" | **Medium (accuracy risk)** | `prompts.ts:457,459` vs `:483` | Agentic Abstention 2026 |
| 15 | No fuse review; no MSIX containerization test; no WACK run | **Low-Medium** | `package.json` (no fuses); `electron/main.ts:53-56,850-853` | Electron checklist #19; MSIX overview |
| 16 | Unsigned Windows binaries; playbook/memory path jail partial; source≠build | **Blocker** (pre-existing) | `electron-builder.yml:24-75`; `playbook.ts:104-119`; `memory.ts:125-148`; `SECURITY-FINAL.md:57-95` | Founder's "everything high" requirement |

## 7. Credit where due — things I would not change

- `main.ts:122-193` CSP engineering (hash sidecar shipped inside the asar, byte-verified by an earlier audit).
- `mcp.ts:129-151,769-771` tool-call retry discipline — genuinely correct idempotency thinking.
- `mcp.ts:2341-2366` tool-poisoning scanner + `:1727` name-collision guard.
- `mcpOAuth.ts:232-246,360-375` state/PKCE/XSS-escaping hygiene and `:62-105` token encryption.
- `providers.ts:1375-1432` cache-breakpoint design and the v11.16 stable/dynamic system split.
- `prompts.ts:483,575,662-671,731` written accuracy contract with evidence requirements.
- The honest existing audits themselves (`SECURITY-FINAL.md`, `MICROSOFT-STORE-READINESS.md`) — they name their own failures with `file:line`, which is rarer than it should be.

## 8. Source index (web)

| Topic | URL |
|---|---|
| MCP transports / resumability / session | https://modelcontextprotocol.io/specification/2025-11-25/basic/transports |
| MCP authorization (OAuth 2.1, PKCE, RFC 8707/9728, CIMD) | https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization |
| MCP security best practices (SSRF, confused deputy, URL validation, scopes, stdio) | https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices |
| Tool poisoning / rug pull / shadowing | https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks |
| MCP tool attack taxonomy | https://www.elastic.co/security-labs/threat-command/mcp-tools-attack-defense-recommendations |
| Rug-pull controls (Zero Trust) | https://learn.microsoft.com/en-us/security/zero-trust/catalog-ai-attack-techniques/rug-pull-attack |
| Electron security checklist | https://www.electronjs.org/docs/latest/tutorial/security |
| Electron IPC guide | https://www.electronjs.org/docs/latest/tutorial/ipc |
| MSIX overview (identity, signing, containerization) | https://learn.microsoft.com/en-us/windows/msix/overview |
| Store policy v7.20 | https://learn.microsoft.com/en-us/windows/uwp/publish/store-policies |
| SSE fields / reconnect / limits | https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events |
| Resume tokens / last-event IDs | https://ably.com/blog/resume-tokens-last-event-id-llm-streaming-reconnection |
| SSE idempotency runbook | https://www.midytech.com/ai-chat-sse-last-event-id-reconnect-idempotency-runbook/ |
| Foundry reconnect streaming | https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/stream-with-reconnect |
| Anthropic prompt caching | https://platform.claude.com/docs/en/build-with-claude/prompt-caching |
| Agentic abstention | https://arxiv.org/abs/2606.28733 |
| Groundedness / confidence gates | https://agentgrading.ai/guides/how-to-measure-rag-groundedness |

---

**Final word / كلمة أخيرة:** The research question was "what does 2026 best practice require, and what does SADEEM already do?" The answer is uncomfortable but useful: SADEEM already does most of the *visible* hardening (CSP, isolation, scanner, caching, accuracy contract) and consistently misses the *maintenance* hardening (framework currency, complete IPC gating, current protocol revision, Store packaging details, stream replay). Those are less glamorous, but they are what separate "impressive prototype" from "shippable high-security product". Fix rank 1–9, then re-run this comparison. / الإجابة: سادم يتقن ما هو مرئي ويُهمل ما هو مستمر — حدّث الإطار، وأغلق القنوات، وواكب المواصفة، ثم أعد المقارنة.
