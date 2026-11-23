# INTERNET / DOWNLOAD / PREVIEW GUARD — v11.34 (V5) / حارس الإنترنت والتنزيل والمعاينة

**Date:** 2026-11-21  
**Test:** `tests/v1134-internet-guard.test.mjs`  
**Run:** `node --test --test-force-exit tests/v1134-internet-guard.test.mjs`  
**Artifacts:** `tests/.v1134-internet-guard.results.json` (machine-readable, written by the test)  
**Scope:** DIAGNOSIS + TEST ONLY — this guard changes no product code.  
**Method:** a real loopback `node:http` server for the executors, a stubbed global `fetch` only for DNS / timeout / DuckDuckGo failure classes, and the **real** `electron/agent/engine.ts` (esbuild-bundled, electron stubbed) driven by a local scripted OpenAI-compatible provider. Zero external network, zero model. Assertions are about bytes on disk, responses on the wire, and events in the tool dispatcher — not source strings.

---

## 1. Blunt verdict / الحكم الصريح

> **EN — Does "AI can't use internet / download / preview" still reproduce? NO — not in any code path this guard can reach. All 12 checks pass (13/13 TAP, exit 0).** The V5 plumbing in this tree is real: `web_fetch` returns verbatim CSS from a live loopback server, `download_file` writes byte-for-byte exact files to a jailed workspace path, `http_request` gets real status + body, DNS/timeout/403/404 are four distinct single-language errors with a next step, `web_search` both parses real result HTML and fails honestly, and `preview` starts a real HTTP server whose returned URL actually serves the file. **The "can't" claim is refuted at the plumbing level.**
>
> **But be honest about what this does NOT prove.** This harness *forces* the scripted provider to emit the tool call. It proves the engine **can** use these tools and that the results reach the model verbatim — it **cannot** prove a real model will *choose* to call them on a vague "browse the web" request. That failure class (zero-tool "done", from `docs/AI-REALITY-V1132.md`) lives in model behaviour, not in these executors. Likewise, external DuckDuckGo/CDN reachability is exercised only via a stubbed `fetch` + a loopback server — this run makes **no** claim about a live internet connection from this machine. The founder's UX judgement remains authoritative for those two gaps.

> **AR — هل ما زال «الذكاء لا يستطيع استخدام الإنترنت / التنزيل / المعاينة» يتكرر؟ لا — ليس في أي مسار برمجي يصل إليه هذا الفحص. كل الفحوص الـ١٢ ناجحة (١٣/١٣ في TAP، رمز خروج ٠).** آليات V5 في هذه الشجرة حقيقية: `web_fetch` يُعيد CSS حرفياً من خادم محلي حي، و`download_file` يكتب ملفات مطابقة بايت-بالبايت داخل مساحة عمل محصورة، و`http_request` يحصل على حالة وجسم حقيقيين، وأخطاء DNS والtimeout و403 و404 أربعة أخطاء مختلفة بلغة واحدة مع خطوة تالية، و`web_search` يحلل نتائج حقيقية ويفشل بصدق، و`preview` يشغّل خادم HTTP حقيقياً عنوانه يقدّم الملف فعلاً. **ادعاء «لا يستطيع» دُحض على مستوى الآليات.**
>
> **لكن لنكن صادقين عمّا لا يثبته هذا الفحص.** هذا الهيكل *يُجبر* مزوّد الاختبار على إصدار استدعاء الأداة؛ يثبت أن المحرك **يستطيع** استخدام هذه الأدوات وأن نتائجها تصل إلى النموذج حرفياً، لكنه **لا يثبت** أن نموذجاً حقيقياً سي*ختار* استدعاءها عند طلب غامض مثل «ابحث في الويب». تلك الفئة (الانتهاء بـ«تم» بلا أدوات، انظر `docs/AI-REALITY-V1132.md`) تخص سلوك النموذج لا هذه المنفّذات. كذلك، الوصول إلى DuckDuckGo/CDN الخارجي تم عبر `fetch` وهمي وخادم محلي فقط — هذا التشغيل **لا** يدّعي اتصالاً حياً بالإنترنت من هذه الآلة. حكم المؤسس يبقى هو المرجع لتلك الفجوتين.

---

## 2. Results / النتائج

| # | Check (test line) | Criterion | Result | Evidence |
|---|---|---|---|---|
| G0 | `v1134-internet-guard.test.mjs:305` | AI can see the tools | ✅ PASS | `full` + `balanced` profiles expose `web_search, web_fetch, http_request, download_file, web_download, preview` |
| G1a | `:322` | 1 — real loopback CSS | ✅ PASS | verbatim `.hero > svg` + `content: "<arrow>"`, byte count, real `content-type: text/css` |
| G1b | `:334` | 1 — jailed exact bytes | ✅ PASS | bytes on disk === bytes served; escaping dest refused (fullAccess off) |
| G1c | `:352` | 1 — http_request | ✅ PASS | `HTTP 200` + real JSON body from a live server |
| G2a | `:365` | 2 — 403 vs 404 | ✅ PASS | distinct `HTTP 403` (access refused) vs `HTTP 404` (not found); honest contract enforced by `assertHonestError` (`:177`) |
| G2b | `:383` | 2 — DNS vs timeout | ✅ PASS | distinct `DNS resolution failed for "no-such-host.invalid"` vs `timed out after … ms`; no "I can't", no raw JSON, no Arabic, next step present |
| G3a | `:406` | 3 — search parse | ✅ PASS | ranked URL + snippet, `uddg=` decoded, `&amp;` unescaped |
| G3b | `:425` | 3 — search fallback | ✅ PASS | `Web search is currently unavailable` + `none were fabricated` + `web_fetch` / `web_download` next step |
| G6 | `:444` | 1 — engine reality | ✅ PASS | engine dispatched `web_fetch` + `download_file` + `http_request`; real file written; web bytes + download path/verification reached the next model turn |
| G4a | `:498` | 4 — real preview | ✅ PASS | `preview` → `preview_open http://127.0.0.1:4174`, `fetch(url)` returned **200** and served the written sentinel — not a fabricated "ready" |
| G4b | `:534` | 4 — honest failure | ✅ PASS | no `package.json` → `ok:false`, `"Preview npm start failed: No package.json in this workspace — try a Python or static preview target."`, no fake URL / "ready" |
| G5 | `:560` | 5 — preview-open capability | ✅ PASS | `preview` tool advertised in `balanced` with `static`/`dev_start`; calling it through the engine emitted a live `preview_open` URL that served bytes |
| VERDICT | `:579` | process must fail on any red | ✅ PASS | `V5 VERIFIED — all 12 internet/download/preview checks pass`, exit 0 |

`node:test` summary: **tests 13 / pass 13 / fail 0**, duration ≈ 4.8 s.

---

## 3. Exact implementation anchors (where the guarantee lives) / مواقع التنفيذ

These are the file:line anchors a V5 regression should be checked against. All were green at run time; there are **no product failures to report**. (The two reds in the *first* run were harness expectation bugs in this guard, now corrected — see §5.)

| Criterion | Implementation | What makes it honest |
|---|---|---|
| Tools visible | `electron/agent/tool-defs.ts:2242-2260` (ESSENTIAL), `:2294-2296` (`defsForProfile`) | `web_fetch`, `web_download`, `web_search`, `preview` in ESSENTIAL; `http_request`, `download_file` not in ADVANCED → visible in `balanced` |
| web_fetch verbatim | `electron/agent/tools.ts:3431-3533` | content-type aware strip at `:3470-3508` (only HTML stripped; CSS/JSON verbatim); byte meta at `:3510-3512` |
| download_file | `electron/agent/tools.ts:5060-5063` (success), write jail `:878-905`, host guard `:5063` on | reports real path + verified byte count; refuses escaping dest and blocked hosts before a byte is written |
| http_request | `electron/agent/tools.ts:4844-4937` | real browser UA `:4881-4887`, bounded body `:4920-4926`, distinct status note `:4928-4936` |
| Distinct errors | `electron/agent/tools.ts:701-756` (`classifyFetchError`), `:759-786` (`explainHttpStatus`) | unwraps `err.cause` (ENOTFOUND / TimeoutError / CERT_* / ECONNREFUSED…); 401/403, 404/410, 429, 5xx each own sentence + Fix |
| web_search | `electron/agent/tools.ts:3309-3313` (fallback), `:3316-3347` (parse), `:3350-3399` (endpoints + anti-bot detection) | anti-bot/anomaly page treated as failure, never a fake "No results"; explicit unavailable + next tool |
| preview server | `electron/services/previewService.ts:727-889` | **real** `createServer` + `listenOnPreferred` `:869-882`, real port in `staticUrl`, `state:'ready'` only after the socket binds |
| preview honesty | `electron/services/previewService.ts:1277-1337` (honest `devStart` failures), `:1341-1381` (stale-port guard + 20 s cap) | "No package.json / no dev script / no Python / no go.mod" returned as `ok:false`; pre-existing port never claimed as "ours" |
| preview-open event | `electron/agent/tools.ts:5615-5679` (static/dev_start emit `preview_open` with URL), `engine.ts:2994-3000` (ctx.emit → UI) | the AI-callable `preview` tool produces the same `preview_open(ws,url)` event the UI consumes |
| tool result to model | `electron/agent/engine.ts:6243` | `tool_result` carries `ok` + full `output` into the next model turn |

---

## 4. What this proves vs what it does not / ما يثبتَه وما لا يثبتَه

- **Proves:** the executor plumbing and the engine dispatcher are intact for all five guarantees, including the *reality* path (bytes reach the model; preview URL answers HTTP 200 with the right content). A regression in any of these turns this guard red with a named check ID.
- **Does not prove:** (a) a real model will *volunteer* these tool calls — that is the zero-tool-`done` / MCP-opt-in gap in `docs/AI-REALITY-V1132.md`, still open; (b) live outbound internet from this machine — DDG/CDN paths are stubbed; (c) rendered UI quality / RTL / "in boxes" taste — the founder's eye is authoritative there.
- **Verdict for the founder's sentence:** *"AI can't use internet / download / preview"* → **does not reproduce when the tool call is emitted.** If it still happens in the app, the cause is upstream of the executors (model tool-choice / prompting / UX), and this guard will stay green — which is exactly why it is paired with the reality suite rather than replacing it.

---

## 5. Reproduction notes / ملاحظات التشغيل

- First run: **2/12 failed** — both were **this guard's** wrong expectations, not product defects: (i) G6 asserted the downloaded file's *content* would appear in the model transcript, but `download_file` honestly reports the verified **path + byte count** instead; the assertion now checks the path/verification in the transcript and the exact bytes on disk separately. (ii) G4b's honesty regex didn't count "**try** a Python or static preview target" as a next step; `Try` was added. After those corrections: **12/12, exit 0**.
- `web_fetch` / `download_file` / `http_request` against `127.0.0.1` require `fullAccess` (SSRF guard) — the test context sets it deliberately.
- The preview static server binds a real port (`127.0.0.1:4173+`); the test stops it in `after()`. No external network is opened at any point.
- Machine-readable results: `tests/.v1134-internet-guard.results.json` (generated, not committed source).
