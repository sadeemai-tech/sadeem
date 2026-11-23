# FULL SMOKE — v11.31 (11.12.x line)
## تقرير الدخان الشامل — النسخة 11.31

> **Diagnosis + test ONLY. No application source was edited by this agent.**
> **تشخيص واختبار فقط. لم يعدّل هذا الوكيل أي ملف من ملفات التطبيق.**
> Guard: `tests/v1131-full-smoke.test.mjs` — the agent wrote only this test + this report.
> Reuses the proven v1128 harness (60-screen SSR, React #300 scan, dead-control scan,
> real `kdx:agent:run` IPC shapes) and carries eight wave checks V1–V8.

---

## 1. الحكم — VERDICT (Arabic)

**أخضر — بصراحة، مع تحفّظات تُقال كاملة.** شغّلت الحاجز مرتين على الملف النهائي النهائي:
**82 اختبار، 82 نجح، 0 فشل**، exit code = 0، وعدّات متطابقة. لم تُجمَّل النتيجة.

ما فُحص فعلاً: الـ 60 شاشة كلها تُحزَّم وتُrender عبر SSR؛ **679 عنصر تحكّم** فُحصت
بصفر تحكّم ميت؛ صفر محدِّد غير مستقر (React #300)؛ **6/6** أشكال `kdx:agent:run`
الحقيقية مرّت. موجة v11.31 نفسها: لا صفوف REPORT/TAINT/CLAIM-AUDIT/PROOF في ردّ
بسيط، زر PROOF واحد يعمل بنصّ حقيقي، كرة الكونتيكس تظهر دائماً، **دائرة واحدة فقط**
(حلقة التشغيل spinner في شريط التشغيل بـ ChatPanel، وصفر نسخ في MessageView)، ومسارات
429/DNA/skills/MCP/slash كلها موصلة ومحمّلة.

**كونوا صادقين — أربع نقاط لا تُجمَّل:**
1. عدد عناصر التحكّم **679 لا 674**. الأساس في v1128 كان 674؛ وكلاء الميزات أضافوا
   عناصر في هذه الموجة، فالرقم الصحيح اليوم 679. الحاجز يتحقق من ≥640 ويُبلّغ عن الرقم الفعلي.
2. **مسار DNA ليس محجوزاً بالعمل الحقيقي.** قرار منتج من v1127 يبقي الاستخراج على كل
   دورة مكتملة. V7 يتحقق من التوصيل والأحداث والمستهلكين، **لا** من منع إشعار تعلّم في ردّ «سلام».
3. فحوص skills/MCP/slash هي **مصدر + تحميل وحدات + registry**؛ ليست إعادة تشغيل اختبارات
   السلوك العميقة (`tests/v1131-*.test.mjs`) ولا جلسة MCP حقيقية.
4. 429 هنا **fetch وهمي**، وليس حدّ معدّل حقيقي من مزوّد.

النتيجة: **أخضر لما فُحص، وليس تفويضاً بما لم يُفحص.**

---

## 2. Verdict (English)

**GREEN — bluntly, with the caveats stated in full.** I ran the guard twice against the
final file: **82 tests, 82 pass, 0 fail**, exit 0 both times, byte-identical count lines.
Nothing was glossed over.

What was checked: all 60 screens bundle + SSR-render; **679 controls** scanned with
**zero dead controls**; **zero unstable selectors (React #300)**; **6/6** real
`kdx:agent:run` param shapes pass. The v11.31 wave itself: no REPORT / TAINT /
CLAIM-AUDIT / PROOF rows on a plain turn; one working PROOF button with a real clipboard
write; the context orb always mounted; **exactly one circle** (the spinner in ChatPanel's
run strip, zero gutter copies in MessageView); and the 429 / DNA / skills / MCP / slash
paths all wired and loadable.

**Blunt caveats — four things not glossed over:**
1. The control count is **679, not 674**. The v1128 baseline was 674; feature agents added
   controls in this wave, so the correct number today is 679. The guard asserts ≥640 and
   reports the real figure.
2. **The DNA path is not gated on real work.** A v1127 product decision keeps extraction on
   each completed turn. V7 verifies wiring, events and store consumers; it does **not**
   assert a two-word "salam" is free of a learning toast.
3. The skills / MCP / slash checks are **source + module-load + registry** evidence — not a
   re-run of the deep behavioural suites (`tests/v1131-*.test.mjs`), not a live MCP round-trip.
4. The 429 event here is a **mocked fetch**, not a live provider rate limit.

Bottom line: **green for what was checked, not a licence for what was not.**

---

## 3. Exact counts — both final runs

| Metric | Run 1 | Run 2 |
|---|---|---|
| Tests total / pass / fail | 82 / 82 / **0** | 82 / 82 / **0** |
| Exit code | **0** | **0** |
| Screens bundled + SSR'd | **60** | **60** |
| Screens RENDERS OK / CRASHES / UNTESTABLE | **60 / 0 / 0** | **60 / 0 / 0** |
| Controls scanned | **679** | **679** |
| Dead controls | **0** | **0** |
| Unstable selectors (React #300) | **0** | **0** |
| `kdx:agent:run` shapes pass / fail | **6 / 0** | **6 / 0** |
| Circle — run-strip SVG / gutter hooks / tremor hooks | **1 / 0 / 0** | **1 / 0 / 0** |
| Paths — skills / mcp / slash commands | **1 / 1 / 44** | **1 / 1 / 44** |
| Wave sub-check failures (V1–V8) | **0** | **0** |
| Duration | 70.3 s | 33.8 s |

Machine counts line (both final runs, byte-identical):

```
V1131_FULL_SMOKE_COUNTS={"screens":60,"screens_ok":60,"controls_scanned":679,"dead_controls":0,"unstable_screens":0,"taint_rows_ssr":0,"claim_audit_rows_ssr":0,"report_rows_ssr":0,"proof_rows_ssr":0,"proof_toggle_ssr":1,"proof_panel_ssr":0,"context_orb_ssr":1,"ctx_meter_ssr":false,"circle_strip_svg":1,"circle_gutter_hooks":0,"circle_tremor_hooks":0,"paths_skills":1,"paths_mcp":1,"paths_slash_commands":44,"engine_shapes":0,"engine_pass":0,"wave_failures":0}
V1131_FINAL_FAILURES=0
```

`engine_shapes`/`engine_pass` print as 0 in that line because test `99 · WAVE COUNTS`
runs before the engine tests; the authoritative `after()` report is **6 / 0**.

Command:

```
node --test --test-force-exit tests/v1131-full-smoke.test.mjs
```

Machine artifacts (tmp): `results.json`, `engine-results.json`, `crashes.log` under
`D:\ORION\data\cache\tmp\sadeem-v1131-full-smoke\`.
Final run logs: `v1131-smoke-FINAL1.log`, `v1131-smoke-FINAL2.log` under
`D:\ORION\data\cache\tmp\opencode\`. (Diagnostic runs `RUN1.log` / `RUN2.log` are kept
alongside — see §4.) A third confirmation pass (`v1131-smoke-CONFIRM.log`, 37.7 s) was run
after `electron/agent/engine.ts` changed again at 08:03; it was also **82/82, exit 0** with
byte-identical counts.

Stability: I snapshotted all 317 source/electron/website files repeatedly before the run;
feature agents were editing throughout (16–18 files per 45–100 s window). I waited until the
**15 key files this guard depends on** were unchanged across a 30 s window, ran two diagnostic
passes, fixed the harness state leak described in §4, then ran the two final passes above.

---

## 4. Failure ledger — every failure with file:line

**Final runs: ZERO failures.** Both `V1131_FINAL_FAILURES=0` and
`100 · FINAL FAILURE LEDGER` passed.

**Transient harness defect found and fixed during this diagnosis (NOT an app defect).**
Recorded so the green is not mistaken for luck:

| # | Where in the TEST | Symptom | Root cause | Resolution |
|---|---|---|---|---|
| 1 | `tests/v1131-full-smoke.test.mjs` — engine IPC `baseParams()` / `empty-messages` | First diagnostic pair: Run 1 was 82/82; Run 2 was **78/82** — `ENGINE normal`, `model-as-string`, `missing-messages+text` failed with `terminal report invariant failed … requests=0`, while the event stream itself was healthy (`sys_notice,heartbeat,heartbeat,text_delta,message_end,task_report,turn_end`) | The engine persists session journals/traces under the shared userDataDir. Both runs reused the same session IDs (`v1131-drive-0/1/2`), so Run 2 **restored the old journals** instead of calling the mock provider — hence `requests=0`. The run itself did not misbehave; the harness assumption "a fresh run must hit the provider" broke. | Added a per-process `RUN_TOKEN` (`process.pid`-`Date.now()`) to every engine session ID and cleared the stale journals/traces. Re-ran twice cleanly (FINAL1 / FINAL2, 82/82 each). No application file was changed. |

Source markers asserted with file:line on failure (all passed):

| Check | Files / anchors | Result |
|---|---|---|
| V1 | `src/components/MessageView.tsx` · `PROOF_ONLY_ROWS`; `src/store.ts` · `rrEmitReportToast` / `lastTaskReport` | ✅ |
| V2 | `electron/agent/engine.ts` · `realWorkThisRun` gating; `MessageView.tsx` · `PROOF_ONLY_ROWS`; `taint.ts` / `tools.ts` detection intact | ✅ |
| V3 | `src/components/ProofRibbon.tsx:447` · one `data-testid="proof-toggle"`, `handleProofCopy` → `clip.writeText` | ✅ |
| V4 | `src/components/ContextLens.tsx:100` · `const noData = !hasData`; `Composer.tsx:2081` · one `<ContextLens compact />` | ✅ |
| V5 | `src/components/ChatPanel.tsx` · `RunStatusLine` exactly one `<svg>`; `MessageView.tsx` · zero gutter/tremor hooks | ✅ |
| V6 | `electron/agent/providers.ts:754` · `RATE_LIMIT_BACKOFF_CAP_MS=1000`; bounded same-provider 429 runtime | ✅ |
| V7 | `electron/agent/engine.ts` · `learnDNAFacts` / `learnPlaybookFacts`; `src/store.ts` · `dna_updated` / `playbook_learned` consumers | ✅ |
| V8 | `engine.ts:43/2447` · skills index; `engine.ts:73/1573` · MCP bridge; `src/lib/modes.ts:134` · `SLASH_COMMANDS` (44); `slashService.ts:182` · `dispatchSlashCommand` | ✅ |

---

## 5. Wave-by-wave findings (file:line)

### V1 — NO REPORT card / TaskReportCard ✅
- `src/components/MessageView.tsx:2921` — `PROOF_ONLY_ROWS` drops a stale `task-report`
  row; no `TaskReportCard` component or dispatch branch survives.
- `src/store.ts` — the written report is ONE localized toast (`rrEmitReportToast`) plus
  the `lastTaskReport` slice; no chat card is pushed.
- SSR: a plain turn renders 0 REPORT cards; a synthetic `task-report` row renders nothing. ✅

### V2 — NO taint / claim-audit / proof rows ✅
- `electron/agent/engine.ts` — `realWorkThisRun` gates `claim_audit` / `proof_package`;
  renderer defence-in-depth drops synthetic proof/audit rows.
- Taint UI is absent while security enforcement (`taint.ts` / `tools.ts`) stays intact.
- SSR: 0 taint, 0 claim-audit, 0 PROOF rows on a plain turn. ✅

### V3 — ONE working PROOF button ✅
- `src/components/ProofRibbon.tsx:447` — one `data-testid="proof-toggle"` / `pr-proof-toggle`,
  no popover/tally/panel. `:410–:452` — `handleProofCopy` → `clip.writeText` + honest toast;
  `:438` — `if (!proofVisible) return null;`.
- SSR work turn: 1 toggle, 0 panels; idle turn: 0 proof UI. ✅

### V4 — Context orb ALWAYS visible ✅
- `src/components/ContextLens.tsx:100` — `const noData = !hasData;` replaced the fresh-session
  hide gate; honest em-dash centre, "window size unknown" tip.
- `src/components/Composer.tsx:2081` — one `<ContextLens compact />` beside the mic;
  no ChatPanel / StatusBar duplicate. ✅

### V5 — ONE circle ✅
- `src/components/ChatPanel.tsx:459` — `RunStatusLine`; its strip holds **exactly one**
  `<svg>` (`:543`) with `animateTransform` (`:558`) and a real elapsed clock (`:575`).
- `src/components/MessageView.tsx` — zero gutter-circle hooks, zero trembling-decor hooks;
  the one reasoning-head instrument (`PrecisionThinkingOrbit`, `:1050`) remains.
- SSR streaming=true/false: no gutter circle, no trembling decor, plain reasoning text. ✅

### V6 — 429 continuation path ✅
- `electron/agent/providers.ts:754` — `RATE_LIMIT_BACKOFF_CAP_MS = 1000`;
  `:1006` — "waiting briefly and continuing the same task (no provider switch)";
  `:185` — `MAX_STREAM_CONTINUATIONS` for stream-drop recovery.
- Real `streamTurn` runtime (mock 429, 429, 200): same provider retried, one consolidated
  `rate_limited` notice, zero error rows, answer continues, `stopReason === 'end_turn'`. ✅

### V7 — DNA path ✅ (with the caveat in §1/§2)
- `electron/agent/engine.ts` — `learnDNAFacts` / `learnPlaybookFacts` wired; `dna_updated`
  / `playbook_learned` events emitted; `src/store.ts` has both consumers.
- **Not asserted:** the `realWorkThisRun` gate at the two learner conditions. ⚠️ for the
  plain-turn toast, ✅ for wiring.

### V8 — Skills / MCP / Slash paths ✅
- **Skills:** `electron/agent/engine.ts:2447` calls `skillsIndexLine(workspace, skillsTaskText)`
  for the prompt; `:5721` handles `use_skill`; `skills.ts` exports `skillsIndexLine`,
  `matchSkillsForTask`, `selectSkillsForPrompt`, `renderSkillInjection`;
  `prompts.ts:956` carries the SKILLS-FIRST rule; `skillGate.ts` has the evidence gate.
- **MCP:** `engine.ts:73` imports `cachedToolsForEngine, mcpListTools`; `:1573` enumerates
  MCP tools; `mcp.ts` exports `createClient`, `mcpListTools`, `mcpCallTool`,
  `cachedToolsForEngine`, `closeAllMcpClients`; MCPPanel is in the 60-screen SSR set.
- **Slash:** `src/lib/modes.ts:134` holds the canonical 44-command `SLASH_COMMANDS`
  registry plus `parseSlashCommand` / `isSlashMenuQuery`; `Composer.tsx` wires the menu;
  `store.ts` has real slash handlers/toasts; `slashService.ts:182` has
  `dispatchSlashCommand`. Runtime parse of `/status now` → `{name:'status', args:'now'}`. ✅
- **Blunt note:** this is wiring + loadability, not the deep behaviour proof. Those live in
  `tests/v1131-skills.test.mjs`, `v1131-engine.test.mjs`, `v1126-slash-all.test.mjs`,
  `v1126-mcp-use.test.mjs`.

---

## 6. What this smoke does NOT prove (honest limits)

1. **Not a browser / website build.** No Next.js build, no rendered DOM, no click test.
   The v1128 website-section check was intentionally dropped for this wave brief.
2. **Not the DNA real-work gate.** A plain turn may still fire a background DNA/Playbook
   call and a learning toast by product decision. Do not read V7 green as "no DNA toast on 'salam'".
3. **Not the deep skills / MCP / slash behaviour.** V8 proves wiring and loadable APIs, not a
   real MCP round-trip or an end-to-end skill promotion (see the v1131 deep suites).
4. **Not an hours-long continuity / 145-tool sweep.** Engine shapes are short local mock
   turns; dead controls are a static source scan.
5. **The 429 event is a mocked fetch**, not a live provider rate limit.

**Bottom line / الخلاصة:** البنية المفحوصة خضراء، ومرّت مرتين بـ 82/82؛ لكن «منع إشعار DNA
بلا عمل» و«السلوك العميق لـ skills/MCP/slash» و«بناء الموقع» لم تُثبت هنا — لا تدّعيا ذلك.
The checked structure is green, twice, 82/82 — but "no DNA toast without work", "deep
skills/MCP/slash behaviour" and "website build" are **not** proven here. Do not claim them.
