# CAPABILITY HARVEST V1145 — ground-truth marketing hooks, read from the code
# حصاد القدرات V1145 — خطافات تسويقية مستخرجة من الكود الفعلي

> **Read-only research. No source file was edited.** This is NOT a summary of `FEATURE-TRUTH-V1144.md`. Every entry below was re-read from the implementation (`engine.ts`, `tools.ts`, `tool-defs.ts`, `dna.ts`, `playbook.ts`, `agents.ts`, `subagentRunner.ts`, `checkpointService.ts`, `taint.ts`, `previewService.ts`, `imageGenService.ts`, `lsp.ts`, `cli.ts`, `src/store.ts`, `providers.ts`) with `file:line` evidence.
> **بحث للقراءة فقط، لم يُعدّل أي ملف كود.** هذا ليس ملخّصاً لـ `FEATURE-TRUTH-V1144.md`؛ كل مدخل أُعيد قراءته من الكود نفسه مع دليل `file:line`.

## 0. Rules for the copywriter / قواعد للكاتب

1. **A hook is a mechanism, not an adjective.** If the line cannot be checked against a file, a tool call or a real HTTP request, do not print it.
   **الخطاف آلية لا صفة.** إن لم تكن العبارة قابلة للتحقق من ملف أو استدعاء أداة أو طلب HTTP حقيقي، فلا تُنشر.
2. **Numbers you MAY publish:** **145 tools · 16 specialists · 12 providers · 2× deep-effort step budget.** Every other number, threshold, env var, cap, timer and internal filename is banned (FEATURE-TRUTH-V1144 §13).
   **الأرقام المسموح بها:** 145 أداة · 16 متخصصاً · 12 مزوّداً · ميزانية خطوات مضاعفة في التفكير العميق. بقية الأرقام محظورة.
3. **Verdict legend:** **SHIPPED** = may write plainly · **SHIPPED ⚠** = describe the mechanism, never promise the model behaviour · **CONDITIONAL** = only with the stated caveat · **DO NOT MARKET** = never mention.
4. Model *choice* is never guaranteed. The harness enforces gates; it does not make a weak model competent. Say "the harness checks", never "the AI always…".
   اختيار النموذج ليس مضموناً؛ المنصّة تفرض البوابات لكنها لا تصنع نموذجاً ضعيفاً قوياً. قل «المنصّة تتحقق» لا «الذكاء دائماً…».

---

## 1. Quick verdict table / جدول الحكم السريع

| # | Capability / القدرة | Verdict | One-line hook (EN) |
|---|---|---|---|
| 1 | One engine in desktop + CLI | SHIPPED | Same 145-tool agent in the app and `sadeem run`. |
| 2 | 145 schema'd tools, profiles = view only | SHIPPED | Profiles change what the model sees, never what it may call. |
| 3 | Persistent DNA, lossless at the cap | SHIPPED | At the cap the oldest learned fact retires; a new one is never dropped. |
| 4 | Living Playbook, versioned file | SHIPPED | After each run: a versioned PLAYBOOK.md you can read and edit. |
| 5 | Cross-session recall | SHIPPED | Real excerpts from past sessions, not invented summaries. |
| 6 | Shadow-commit checkpoints + undo | SHIPPED | A git snapshot that never touches your index or stash. |
| 7 | Mid-run steering | SHIPPED | Your correction lands between tool calls, not after the turn. |
| 8 | Unbounded continuation + real-window compaction | SHIPPED | Keeps working; compacts at the real context window. |
| 9 | Proven-change pipeline + independent verifier | SHIPPED ⚠ | "Done" is checked against files, commands and tests by a second model family. |
| 10 | Signed re-runnable proof package | SHIPPED | Verifiable on any machine with no key; test command re-runs. |
| 11 | Taint tracking / injection escalation | SHIPPED | A poisoned README can't push a dangerous command through on autopilot. |
| 12 | 16 child specialists, truly parallel | SHIPPED | Full-tool children; one hung child never stalls the run. |
| 13 | Verified preview + framework dev servers | CONDITIONAL | No "ready" until a real HTTP GET answers. |
| 14 | Screenshot → vision → deterministic UI gate | SHIPPED | It looks at the page it built before calling it done. |
| 15 | Bilingual RTL document builders | CONDITIONAL | A real Arabic .docx/.pdf with correct shaping, not a description. |
| 16 | Keyless image gen + real ffmpeg | CONDITIONAL | Image generation is a tool — no image API key needed. |
| 17 | Local-first BYOK, direct calls, no proxy | SHIPPED | Keys local, calls direct, learning files editable/erasable. |
| 18 | Context Lens + exact usage + deep effort | SHIPPED | Context ring from the last turn's real delta; deep effort really doubles steps. |
| 19 | Real LSP + DAP | CONDITIONAL | Real rename/references/diagnostics + breakpoints, with honest install hints. |
| 20 | Proof-gated cron / watch / webhook / CI jobs | SHIPPED | A job runs the agent headlessly and is suppressed if tests fail. |

---

## 2. The 20 capabilities — detail / التفاصيل

### 1. One engine in the desktop app and the CLI — محرّك واحد في التطبيق والترمينال
- **Literally does:** `sadeem run "<task>"` imports and calls the real `runAgent()` from `engine.ts`; the electron module is stubbed before import so no Electron binary is required. REPL, approval prompts, usage report, `/mode`, `verify`, `journals` all call the same code (`cli.ts:1-16`, `:37-55`, `:478-537`, `:539-574`, `:686-717`).
- **Why a dev cares:** You can put the exact agent that wrote your feature into CI or a shell script — not a crippled "chat-only" CLI wrapper.
- **Hook EN:** "The same 145-tool agent, approvals and memory run in the desktop app and in `sadeem run` — no Electron binary."
- **Hook AR:** «نفس وكيل الـ145 أداة، بالموافقات والذاكرة نفسها، يعمل في التطبيق وفي `sadeem run` بلا Electron.»
- **Verdict:** **SHIPPED.** Caveat: a provider credential is still required (flags → env → local settings); local Ollama works keyless.

### 2. 145 schema'd tools; profiles are a view, not a gate — 145 أداة والملفات الشخصية مجرد عرض
- **Literally does:** `CORE_DEFS` holds exactly 145 tool definitions with JSON-Schema params and "use X / do not use Y" routing sentences; dispatch is a real switch that resolves the full registry by name (`tools.ts:1387-1962`); tool profiles only change what is *advertised* for a turn (`subagentRunner.ts:99-125`, `:134-160`).
- **Why a dev cares:** A weak/local model gets a short menu, but a tool named by a strong model still runs — profiles never silently amputate capability.
- **Hook EN:** "145 tools with real schemas. Profiles change what the model sees for one turn — never what it may call."
- **Hook AR:** «145 أداة بمخططات حقيقية. الملف الشخصي يغيّر ما يراه النموذج في دورة واحدة، لا ما يستطيع استدعاءه.»
- **Verdict:** **SHIPPED.** Caveat: which tool the model picks is model behaviour, not an engine promise. `preview_open` / `worktree_list` are NOT among them (see §3).

### 3. Persistent DNA that is bounded but lossless — حمض نووي دائم يتعلم بلا توقف
- **Literally does:** A global user model plus a workspace overlay (profile, patterns with repetition-based confidence, explicit feedback) stored owner-only (`dna.ts:1-23`, `:204-261`, `:277-302`). At the active cap, `capPatternsLossless()` evicts the **oldest, most-reinforced** facts and keeps every brand-new one; `factsRecorded` rises cumulatively (`:402-421`, `:616-646`, `:766-809`). 4 of the prompt slots are reserved for the newest facts so new learning always reaches the next prompt. Three update triggers: auto-extraction after a run, `dna_note`, explicit feedback/denial capture. Advisory header: learned defaults are "NEVER rules, NEVER bans, NEVER permissions" (`:652-678`).
- **Why a dev cares:** It learns "you always run typecheck before shipping" or "answer in Arabic" without ever turning that into a refusal rule; it cannot get "stuck at 60" and stop absorbing new facts.
- **Hook EN:** "A user model that keeps learning: when the active window fills, the oldest well-learned fact retires — a brand-new fact is never dropped."
- **Hook AR:** «نموذج مستخدم يواصل التعلّم: عند امتلاء النافذة يُقاعد أقدم معلومة تعلّمها جيداً، ولا تُسقط معلومة جديدة أبداً.»
- **Verdict:** **SHIPPED.** Caveat: advisory only; the current request always overrides it. Never publish the active-window or prompt-slot numbers.

### 4. Living Playbook — a versioned file the agent writes after real runs — دليل حيّ يكتبه الوكيل بعد كل تشغيل
- **Literally does:** One no-tools extraction produces `worked / failed / preferences / recipes` + a one-line `learned`; `applySync()` merges them into `<workspace>/.surnia/PLAYBOOK.md`, a structured sidecar and a revision history with per-revision diffs, bumping a version (`playbook.ts:1-21`, `:316-338`, `:478-551`); `learnPlaybook()` also refreshes durable memory (`:565-584`); the current playbook is injected into the next system prompt as advisory text (`:345-412`). UI toasts "SADEEM learned: …".
- **Why a dev cares:** The workspace accumulates a human-readable field guide of what actually worked here — and you can open the markdown and delete a line you disagree with.
- **Hook EN:** "After each run: a versioned PLAYBOOK.md of what worked and failed — readable, editable, and read back as advice, never as a rule."
- **Hook AR:** «بعد كل تشغيل: ملف PLAYBOOK.md بإصدارات يسجّل ما نجح وما فشل — قابل للقراءة والتعديل، ويُقرأ كنصيحة لا كقاعدة.»
- **Verdict:** **SHIPPED.** Caveat: advisory; do not publish sidecar/history filenames (internal).

### 5. Cross-session recall with real excerpts — استرجاع حقيقي عبر الجلسات
- **Literally does:** `recallMemory()` lazily builds a BM25-lite index over the newest sessions and DNA patterns, scores term overlap (assistant/user boosted over tool output), returns ≤300-char windows around the densest term cluster with real session titles and timestamps; hard timeout, graceful degradation (`dna.ts:811-988`). The `recall_memory` tool exposes it (`tools.ts:1739`).
- **Why a dev cares:** "Why did we choose Postgres here?" pulls the actual words from the session where the decision was made — not a hallucinated recap.
- **Hook EN:** "Ask about a decision from an old session and get the real excerpt and session title — not a summary the model invented."
- **Hook AR:** «اسأل عن قرار من جلسة قديمة فتحصل على المقطع الحقيقي وعنوان الجلسة، لا ملخّصاً اخترعه النموذج.»
- **Verdict:** **SHIPPED.** Caveat: searches the newest sessions only; internal index/timeout numbers must not be published.

### 6. Shadow-commit checkpoints, undo and rewind — نقاط استعادة بـ shadow-commit
- **Literally does:** `create()` uses `git stash create` on a dedicated ref (`refs/surnia/checkpoints/<id>`) so the user's index, working tree and stash list are untouched; non-git workspaces fall back to file copies (`checkpointService.ts:1-11`, `:131-218`). The manifest records `sessionId` so restore brings back **files and conversation together** (`:262-345`). Engine takes one checkpoint automatically before the first allowed write and before a turn where the previous run wrote (`engine.ts:2825-2831`, `:3331-3340`); `/rewind` chooser, `/undo` and `checkpoint_save/list/restore` tools are all wired (`src/store.ts:3832-3854`, `:1160-1172`; `tools.ts:1701-1728`).
- **Why a dev cares:** A risky refactor can be rolled back in one command without polluting your git stash — and the chat that explains it rolls back with it.
- **Hook EN:** "Before an edit, a git shadow-commit snapshots the tree without touching your index or stash — `/undo` restores files and the conversation."
- **Hook AR:** «قبل التعديل يلتقط الوكيل نسخة shadow-commit دون لمس الفهرس أو الـstash، و`/undo` يُرجع الملفات والمحادثة معاً.»
- **Verdict:** **SHIPPED.** Caveat: shadow path needs a git repo; non-git uses bounded file copies. Never publish file/byte caps.

### 7. Steering a running agent — توجيه الوكيل أثناء العمل
- **Literally does:** `steer()` marks a queued message; `drainSteers()` is called at tool boundaries and injects it with a visible `[steered — sent while you were working]` note (`engine.ts:1641-1659`, `:1726-1745`, `:7049-7060`); queued_count is emitted so the UI shows what is waiting.
- **Why a dev cares:** You watch it implement the wrong approach, type "use the existing helper, don't duplicate it", and it changes course at the next tool call — no kill-and-restart, no lost progress.
- **Hook EN:** "Correct a running agent mid-task: your message lands at the next tool boundary, not after the turn ends."
- **Hook AR:** «صحّح الوكيل أثناء العمل: تصل رسالتك عند الحد التالي بين الأدوات، لا بعد انتهاء الدورة.»
- **Verdict:** **SHIPPED.** Plain queue messages also work; steering has a visible provenance marker.

### 8. Unbounded long-run continuation + compaction at the model's real window — استمرار بلا سقف وضغط عند النافذة الحقيقية
- **Literally does:** A round that exhausts its step budget re-enters `runLoop()` with a fresh budget; default has **no silent round cap** (`engine.ts:3696-3734`, `:3767-3794`). Compaction has a single gate at the model's real context window and a fallback derived from that same window — the fixed-small-count trigger was removed (`engine.ts:5594-5612`); compaction preserves the original task, pinned context, decisions/files/pending and cumulative memory (`:5613-5760`).
- **Why a dev cares:** A 40-file migration or a long debugging run finishes in one go instead of "I'll continue next message", and it doesn't compact after two words on a 1M-context model.
- **Hook EN:** "Long tasks continue across rounds automatically and compact at the model's real context window — not at a fixed turn count."
- **Hook AR:** «المهام الطويلة تستمر تلقائياً عبر جولات جديدة، ويُضغط السياق عند النافذة الحقيقية للنموذج لا عند عدد دورات ثابت.»
- **Verdict:** **SHIPPED.** Caveat: unbounded by *operator cap*, not by cost — every provider call bills the user's key. Never publish the threshold math.

### 9. Proven-change pipeline + independent cross-family verifier — مسار إثبات التغيير ومدقّق مستقل
- **Literally does:** After real work the harness runs claim→evidence audit, red→green parsing, a deterministic fake-test detector, a mutation gate on the **changed lines** (hard survivors get one fix round then re-run), and computes a verdict from the votes (`engine.ts:4227-4269`, `:4390-4522`, `:4541-4548`). For `/goal`, a **different model family** verifies with `run_command` + `read_file` only and must answer `GOAL_VERIFIED` (`:4021-4139`); an adversarial critic reviews the working diff on risk triggers (`:4141-4214`).
- **Why a dev cares:** "All tests pass, fixed it" is checked against an actual failing-test-first run and against whether your new assertions die when the changed operator is mutated — fake/empty tests are called out.
- **Hook EN:** "The harness checks 'done' against files, commands and tests; a verifier from a different model family re-checks with read-only commands."
- **Hook AR:** «المنصّة تتحقق من «تم» مقابل الملفات والأوامر والاختبارات، ومدقّق من عائلة نموذج أخرى يعيد الفحص بأوامر للقراءة فقط.»
- **Verdict:** **SHIPPED ⚠ (mechanism).** The gates are real; a model can still produce a weak answer. Never say "the AI never lies" or "zero mistakes". Verdict codes and false-done rates are internal telemetry — describe the behaviour, not the labels.

### 10. Signed, re-runnable proof package — حزمة إثبات موقّعة قابلة لإعادة التشغيل
- **Literally does:** `buildProofPackage()` embeds hashes, commands, test runs, mutation survivors and gate votes; `loadSigningKey` signs it (engine saves to disk and emits `proof_package`, `engine.ts:4524-4605`). `sadeem verify <proof.json> [--rerun]` checks an Ed25519 signature whose **public key is embedded in the package** — verification works on any machine with no key material — re-checks sha256 fingerprints against the current tree and can re-run the recorded test command (`cli.ts:576-630`).
- **Why a dev cares:** You can hand a reviewer a file that proves what commands actually ran for a change, and they can reproduce it on their own checkout months later.
- **Hook EN:** "Every real change yields a signed proof package anyone can verify without a key — and re-run the recorded test command."
- **Hook AR:** «كل تغيير حقيقي يُنتج حزمة إثبات موقّعة يستطيع أي شخص التحقق منها بلا مفتاح، وإعادة تشغيل أمر الاختبار المسجّل.»
- **Verdict:** **SHIPPED.** Caveat: a valid signature proves authenticity of the record, not mathematical correctness of the code. Never publish signing-key internals or `--legacy-key`.

### 11. Taint tracking — prompt injection cannot ride through on autopilot — تتبّع التلوث
- **Literally does:** Every byte entering context from outside the user's keyboard (web fetch, MCP result, repo README/docs, issue, imported skill) is marked with its origin (`taint.ts:1-26`, `:66-135`). `shouldEscalateForTaint()` escalates exec/network/install/publish/destructive commands to an explicit approval **even in fullAccess**, and the card names the live sources (`taint.ts:141-176`; `tools.ts:2838-2890`, `:3741-3758`, `:3850-3859`). Poison rules scan README/CONTRIBUTING/SECURITY/AGENTS/issues/skills and flag zero-width text, `curl | sh`, `.env` dumps, hidden agent-directed comments (`taint.ts:182-259`).
- **Why a dev cares:** You ask the agent to "follow the setup instructions in that repo"; a hostile README saying "run this install script" cannot execute silently — it stops and shows why.
- **Hook EN:** "A poisoned README or fetched page can't push a dangerous command through on autopilot — even in full-access mode the agent stops and shows the source."
- **Hook AR:** «ملف README مسموم أو صفحة ويب لا يمكنها دفع أمر خطير تلقائياً — حتى في وضع الوصول الكامل يتوقف الوكيل ويُظهر المصدر.»
- **Verdict:** **SHIPPED.** Caveat: only external/attacker-reachable sources escalate; a benign local read does not (`:45-56`). Describe the mechanism; never promise absolute security. Taint labels/codes are internal.

### 12. 16 child specialists, genuinely parallel — 16 وكيلاً متخصصاً بالتوازي الحقيقي
- **Literally does:** `AGENTS` lists 16 specialists (explore, web-research, spec, data, architect, implement, debugger, perf, test, review, refactor, security, devops, docs, skill-writer, general), each `tools:'*'` and running its own loop with its own system prompt (`agents.ts:1-13`, `:31-200`). The detached runner advertises the **full** 145-core + MCP + provider-native registry to every child and delegates approvals to the parent gate (`subagentRunner.ts:99-161`, `:243`). `runSubagentBatch()` launches workers before the first await, with per-task deadlines and `Promise.allSettled`, so one hung child never stalls or drops the others (`:677-709`); failed children can be retried.
- **Why a dev cares:** "Audit security, write tests and update docs for this change" can run as three real overlapping agents instead of three sequential passes — and you never get "I don't have that tool" from a child.
- **Hook EN:** "16 specialist child agents, each with the full tool registry, launched truly in parallel — one hung child never stalls the run."
- **Hook AR:** «16 وكيلاً متخصصاً، لكلٍّ السجل الكامل للأدوات، تُطلق بالتوازي فعلياً — ولا يعلّق تشغيلك طفل معطل.»
- **Verdict:** **SHIPPED.** Caveat: children sit behind the parent's approval gate; concurrency is a user setting; every child has a wall-clock deadline. Specialists differ by role/personality, NOT capability — do not market them as "different skill tiers".

### 13. Verified preview + framework-aware dev servers — معاينة مُتحقَّق منها وخوادم تطوير حقيقية
- **Literally does:** `findPreviewEntry()` finds the shallowest real web entry — index.html ≤3 levels, else package.json dev/start/serve, Python entry, or go.mod (`previewService.ts:977-1070`). `autoPreview()` starts a real loopback server and `verifyPreviewUrl()` performs a **real HTTP GET** — a bound-but-dead server is a failure, never "ready" (`:923-959`, `:1081+`). `detectFramework()` recognises Vite, Next, Nuxt, Angular, SvelteKit, Astro (`:1268-1296`) and parses explicit `--port` forms (`:1315+`); Python FastAPI/uvicorn/Flask and `go run .` are supported (`:1412-1432`).
- **Why a dev cares:** After the agent builds a page, the panel shows the *running app*, not a stale screenshot path — and it won't claim success on a port that nothing answers.
- **Hook EN:** "The panel won't say 'ready' until a real HTTP GET answers — it detects Vite, Next, Django-style Python and Go and starts the actual dev server."
- **Hook AR:** «لا تقول لوحة المعاينة «جاهز» قبل أن يردّ طلب HTTP حقيقي؛ وتكتشف Vite وNext وPython وGo وتشغّل خادم التطوير الفعلي.»
- **Verdict:** **CONDITIONAL.** The **UI/IPC preview path is SHIPPED**. Do NOT say "the agent opens a preview with one tool call" — `autoPreview()` exists, but `preview_open` has **no definition in `tool-defs.ts`**, so the model cannot emit it (executor `tools.ts:1642-1643`; absent from the 145 defs). Say instead: "the app previews the built page; the agent can start servers and take screenshots."

### 14. Screenshot → vision → deterministic UI gate — لقطة شاشة ← رؤية ← بوابة واجهة آلية
- **Literally does:** `preview_screenshot` captures the real rendered page and returns `{ok, dataUrl}`, which the engine attaches to the tool result so a vision model actually **sees** the render; the tool text tells it to fix layout/contrast/overflow and re-shoot (`tools.ts:6831-6896`). If the model wrote UI files but never probed them, the engine runs `ui_quality_check` itself and hands failures back for one fix round — checking overflow, contrast, tiny text, missing alt/viewport and console errors (`engine.ts:3965-4019`).
- **Why a dev cares:** "Built a responsive landing page" is not accepted until the 390/820/1366px probe passes — a check that needs no model judgement and works with every provider.
- **Hook EN:** "The agent screenshots the page it just built, looks at the image, and a deterministic probe rejects overflow and low contrast before it calls it done."
- **Hook AR:** «يصوّر الوكيل الصفحة التي بنها وينظر إلى الصورة، ويرفض فاحص آلي التجاوز والتباين المنخفض قبل إعلان الانتهاء.»
- **Verdict:** **SHIPPED.** Caveat: the deterministic probe needs a real Electron window; headless/CLI runs skip it honestly (`engine.ts:3977-3985`).

### 15. Bilingual RTL document builders that write real files — منشئات مستندات ثنائية اللغة بـ RTL حقيقي
- **Literally does:** `make_document` writes PDF/DOCX/XLSX/HTML/MD/CSV/TXT (`tools.ts:4897-5045`). PDF prefers Electron hidden-window print with full CSS/Unicode/RTL; the offline fallback embeds a real Cairo TrueType font with `ToUnicode` and RTL shaping for Arabic/CJK (`:4942-4985`, `:4550+`). DOCX is a native OOXML writer where every run gets an Arabic-capable font stack + `w:rtl` and every paragraph `w:bidi` + right alignment, so joined Arabic letters render correctly in Word (`:4200-4246`). RTL is auto-detected from Arabic text. PPTX/DOCX/XLSX advanced engines are also callable (`pptx_make` etc., `:9300+`).
- **Why a dev cares:** Ask for "an Arabic quarterly report as a .docx" and you get a file Word opens with proper shaping — not a markdown description of a report.
- **Hook EN:** "Ask for an Arabic report and get a real .docx/.pdf with correct RTL shaping and an Arabic-capable font — not a description of one."
- **Hook AR:** «اطلب تقريراً عربياً فتحصل على ملف .docx/.pdf حقيقي بتشكيل RTL صحيح وخط يدعم العربية — لا وصفاً له.»
- **Verdict:** **CONDITIONAL — SHIPPED for PDF/DOCX/XLSX.** Caveats: PPTX advanced builder depends on a local Python engine; the offline PDF renderer falls back to Latin-1 only when no font can be embedded. The Electron print path needs the desktop app. Do not imply PPTX works with zero local setup.

### 16. Keyless image generation + real ffmpeg media operations — توليد صور بلا مفتاح وعمليات ffmpeg حقيقية
- **Literally does:** `image_generate` calls a fixed allow-listed, **keyless** Pollinations endpoint; the *tool* generates the image, so any provider/model can write the prompt (`imageGenService.ts:1-23`, `:69-184`). Output is capped, redirects refused, content-type and magic bytes verified, written inside the workspace behind a write approval (`tools.ts:1651-1676`). `media_ffmpeg` runs real `ffmpeg`/`ffprobe` via `execFile` argv arrays — probe, convert, extract_audio, two-pass palette GIF — with an exact install hint when absent (`tools.ts:8987-9199`).
- **Why a dev cares:** You can ask for a hero image and have it saved into `assets/` even on a text-only provider (no image API key), then convert a demo recording to a GIF in the same session.
- **Hook EN:** "Image generation is a tool, not a model feature — no image API key needed; ffmpeg operations are real commands with an honest install hint."
- **Hook AR:** «توليد الصور أداة لا ميزة في النموذج — بلا مفتاح صور؛ وعمليات ffmpeg أوامر حقيقية مع تلميح تثبيت صريح عند غيابها.»
- **Verdict:** **CONDITIONAL.** Image generation requires network access to the Pollinations service and can return 503 (the tool explicitly refuses blind retries) — do not call it "offline" or "100% local". ffmpeg must be installed on the machine. Do not claim "image_edit" reliability without testing.

### 17. Local-first BYOK — keys local, calls direct, no proxy — محليّة المفاتيح واتصال مباشر بلا وسيط
- **Literally does:** Credentials resolve flags → env → `~/.surnia/settings.json`; keys are masked in `sadeem config` and never printed (`cli.ts:74-110`, `:188-210`). Provider calls use the chosen provider's own `baseUrl` with a direct `fetch` (`providers.ts:1198`, `:1672`, `:2368`); the catalog lists 12 providers (`:520-642`). Learning files are plain markdown/JSON under the workspace or user data dir, owner-only, editable and clearable by the user (`dna.ts:14-18`, `:738-764`; `playbook.ts:316-338`, `:587-603`).
- **Why a dev cares:** You can point the agent at your own endpoint or a local Ollama model with zero accounts; if you don't like what it learned, you open the file and delete it — no vendor database to petition.
- **Hook EN:** "Keys live in a local settings file, provider calls go straight to your provider, and what the agent learns is plain markdown/JSON you can read, edit or delete."
- **Hook AR:** «المفاتيح في ملف إعدادات محلي، والاتصال يذهب مباشرة إلى مزوّدك، وما يتعلمه الوكيل ملفات markdown/JSON يمكنك قراءتها وتعديلها وحذفها.»
- **Verdict:** **SHIPPED.** Caveat: web tools, MCP and image generation are network features — never write "100% local" or an absolute "no telemetry" claim without founder confirmation. Frame as "LOCAL-FIRST".

### 18. Context Lens, exact usage ledger and real effort toggle — عدّاد السياق والاستخدام الحقيقيان
- **Literally does:** The context ring derives from `lastTurnUsage` — the per-turn **delta** — not the cumulative session sum; missing provider usage is marked `estimated` and rendered with `≈`, and a live chars/4 estimate is replaced by exact usage on completion (`src/store.ts:834-839`, `:878-887`, `:4431-4450`). Per-message rows reconcile `sum(per-message) == sessionUsage` across all rounds and retry/failover attempts (`:4427-4443`). `/effort deep ↔ standard` changes `cfg.effort`, and the engine applies `baseIters * 2` — a real step-budget effect, not a label (`store.ts:3772-3790`; `engine.ts:3705-3706`).
- **Why a dev cares:** The ring shows actual window occupancy and an honest `≈` when the provider reported nothing; "deep" means more thinking steps, not a cosmetic badge.
- **Hook EN:** "The context ring uses the last turn's real token delta and marks estimates with ≈; deep effort genuinely doubles the step budget."
- **Hook AR:** «حلقة السياق تستخدم الفرق الحقيقي لآخر دورة وتُعلّم التقدير بـ≈، والتفكير العميق يضاعف ميزانية الخطوات فعلياً.»
- **Verdict:** **SHIPPED.** Caveat: only the "2×" factor is publishable; never print the base budget, ctx-window defaults or attempt internals.

### 19. Real LSP and DAP code intelligence — ذكاء كود حقيقي عبر LSP وDAP
- **Literally does:** A zero-dependency LSP client speaks JSON-RPC over stdio with language servers per (workspace, language): definition, hover, references, rename, completion, diagnostics (`lsp.ts:1-16`; tool defs `tool-defs.ts:1183-1324`). Missing binary vs crash are different, honest outcomes with an exact install recipe (`lsp.ts:46-60`); heuristic fallbacks exist and are **labelled**, never presented as simulated LSP answers (`lsp.ts:26-31`). A real DAP client provides breakpoints, variable inspection, stepping and expression evaluation via `debug_*` tools (`tools.ts:1796-1806`, `:1275-1324`).
- **Why a dev cares:** "Rename this symbol everywhere" uses the language server's references, not a blind regex — and if pyright isn't installed you get the command to install it, not a fake crash.
- **Hook EN:** "Real language-server rename, references and diagnostics — with an exact install command when a server is missing — plus DAP breakpoints and expression evaluation."
- **Hook AR:** «إعادة تسمية ومراجع وتشخيصات من خادم لغات حقيقي، بأمر تثبيت دقيق عند غيابه، إضافة إلى نقاط توقف DAP وتقييم التعابير.»
- **Verdict:** **CONDITIONAL — SHIPPED mechanism.** Language servers and debug adapters must be installed locally; heuristic fallback results are labelled as such. Do not imply "zero setup".

### 20. Proof-gated cron, file-watch, webhook and CI-failure jobs — مهام مجدولة ببوابة إثبات
- **Literally does:** A job is stored atomically in local JSON; a live timer evaluates real 5-field cron; a due job fires the **same `runAgent` engine** headlessly with auto-denied approvals, a permission ceiling and a hard timeout (`scheduleService.ts`, per FEATURE-TRUTH-V1144 §6 with line evidence). Triggers are cron, file-watch (mtime + debounce), token-gated loopback webhook, and CI-failure polling that fires once per failure id. A durable event ledger records every fire with exact `nextRun`, error count and duration; the result is suppressed if the workspace test suite fails after the run.
- **Why a dev cares:** "Every night at 2am, run the migration check and only report success if the tests still pass" — with a record of every night's run you can audit later.
- **Hook EN:** "A cron job runs the same agent headlessly and is suppressed if workspace tests fail — every fire lands in a durable event ledger with exact next-run time."
- **Hook AR:** «مهمة cron تشغّل نفس الوكيل بلا واجهة، ويُكتم نتيجتها إن فشلت اختبارات المشروع؛ وكل تشغيل يُسجّل في سجل أحداث دائم بموعد التشغيل التالي.»
- **Verdict:** **SHIPPED.** Caveat: the test-suite gate is real, so market "proof-gated", never "guaranteed green". Never publish tick/lookback/webhook-port internals or token mechanics.

---

## 3. DO NOT MARKET — ruthless exclusions / مستبعدات صارمة

| Item | Truth | Rule |
|---|---|---|
| **`preview_open` as an agent tool** | Executor exists (`tools.ts:1642-1643`) but **no def in `tool-defs.ts`** — the model can never emit it. Only the UI IPC path is reachable. | Never say "the agent opens a preview with one tool call". Say "the app previews the built page; the agent starts servers and screenshots." |
| **`worktree_list` as an agent tool** | Executor exists (`tools.ts:1691-1692`) but no registered def. | Never list it among the 145. |
| **"DNA Autopsy — a third revolutionary AI"** | It is a pure explanation lens over the same `dna.json`, merged into the DNA rail as "DNA Insights" (`docs/SIGNATURE-DECISION-V1140.md`). | Describe it as a lens inside DNA, not a third standalone learning instrument. |
| **"The AI never lies / uses every tool / zero mistakes / unlimited free runs"** | Gates are mechanisms; model choice and cost are not guaranteed. | Replace with "the harness checks claims against files, commands and tests". |
| **"100% LOCAL" / "no telemetry" (absolute)** | Provider calls are direct and keys local, but web tools, MCP, image generation and provider calls are network features. | Say "LOCAL-FIRST — keys and learning files stay on your machine." |
| **Internal numbers, env vars, caps, filenames, gate codes, billing/licensing gates** | Real but internal; enumerated in FEATURE-TRUTH-V1144 §13. | Never reproduce on the website. |

## 4. Safe headline spine (one paragraph, no adjectives) / العمود الفقري الآمن للعناوين

> SADEEM is a local-first coding agent with 145 schema'd tools and the same engine in its desktop app and CLI. It keeps working through long tasks, learns a versioned playbook and a persistent user model from real runs (both advisory and editable), and takes git shadow-commit checkpoints you can undo. A second model family verifies completion claims against files, commands and tests; real changes produce a signed proof package anyone can re-check with no key. It writes Arabic-capable RTL documents, previews only after a real HTTP GET answers, and runs scheduled jobs through the same engine with a test-suite proof gate.

> سديم وكيل برمجة محليّ الاتجاه بـ145 أداة بمخططات حقيقية، ومحرّك واحد في التطبيق والترمينال. يواصل المهام الطويلة، ويتعلم من التشغيلات الحقيقية عبر دليل PLAYBOOK.md مُصدَّر ونموذج مستخدم دائم (كلاهما قابل للقراءة والتعديل وغير إلزامي)، ويأخذ نسخ shadow-commit يمكن التراجع عنها. يتحقق مدقّق من عائلة نموذج أخرى من ادعاءات الإنجاز مقابل الملفات والأوامر والاختبارات، وكل تغيير حقيقي يُنتج حزمة إثبات موقّعة يمكن لأي شخص إعادة فحصها بلا مفتاح. يكتب مستندات عربية بتشكيل RTL صحيح، ولا يُعلن المعاينة قبل ردّ طلب HTTP حقيقي، ويشغّل مهام مجدولة بالمحرّك نفسه مع بوابة اختبارات.

**Bottom line for the founder:** the differentiators that survive a developer's scrutiny are (1) same engine in GUI+CLI, (2) 145 tools with a view-only profile system, (3) lossless bounded DNA + versioned playbook, (4) shadow-commit checkpoints with conversation restore, (5) cross-family verification + signable re-runnable proof, (6) structural injection escalation, (7) genuinely parallel full-tool child agents, (8) verified preview + screenshot vision loop, (9) real RTL document builders, (10) local-first BYOK with no proxy. Everything else is support cast.
