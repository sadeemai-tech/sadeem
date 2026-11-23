# CAPABILITIES INTEGRATION GUARD — v11.12.6
# تقرير التحقق الشامل من الإمكانيات — في 11.12.6

> Diagnosis + test only. No application source was edited by this agent.
> تشخيص واختبار فقط. لم يعدّل هذا العميل أي ملف من ملفات التطبيق.

---

## 1. ما اختبرناه / What was tested

The founder's demand: **«استخرج كل قدرة الذكاء الاصطناعي بالمعنى الحرفي... اختبر كل التولز»**
— extract every AI capability literally and test every tool.

The guard is `tests/v1126-capabilities-guard.test.mjs`. It bundles the **real**
`electron/agent/*` modules with esbuild, stubs Electron, drives a **local scripted
OpenAI-compatible provider** and a **real stdio JSON-RPC MCP server**, and checks
four contracts:

| # | Guard | Arabic |
|---|-------|--------|
| G1 | 145 defs exactly, 145/145 executors reachable, no `tools.slice(0,N)`, profiles only FILTER what the model SEES | ١٤٥ أداة بالضبط، ١٤٥/١٤٥ منفّذ قابل للاستدعاء، لا تقليص للأدوات، الملفات الشخصية تُخفي عن النموذج فقط ولا تحذف |
| G2 | ONE real engine run where the model calls a **core tool + `use_skill` + an MCP tool**; results reach the final answer and the ledgers are written | تشغيل حقيقي واحد يستدعي فيه النموذج أداة أساسية + مهارة + أداة MCP، وتصل النتائج للإجابة النهائية وتُكتب السجلات |
| G3 | Every advertised slash command maps to a real handler with observable effect; no TODO/no-op handlers | كل أمر شرطة مائلة معلَن يرتبط بمعالج حقيقي بأثر مرئي؛ لا معالجات وهمية أو TODO |
| G4 | One blunt aggregate verdict | حكم نهائي صريح |

---

## 2. النتائج / Results

### 2.1 Guard suite — `node --test --test-force-exit tests/v1126-capabilities-guard.test.mjs`

```
G1a source guard .................................................. PASS
G1b executor sweep ....................... PASS  (145/145 reachable: ok=18, honest-refusal=127, unknown=0, threw=0)
G2  real engine run ....................... PASS  (attempts=1; skill=true core=true mcp=true; ledgers written)
G3a slash command source guard ............ FAIL  (2 stale advertised counts — see §3)
G3b slash runtime dispatch ................ PASS  (task-mode / custom / unknown all observable)
G4  verdict ............................... STILL PARTLY COSMETIC (2 failures)
```

Final line from the harness:

> `STILL PARTLY COSMETIC — 2 failing capability guard check(s). TOTAL GUARD FAILURES: 2`

### 2.2 Corroborating suites (existing, unmodified)

```
tests/tool-coverage-all.mjs ............... 2/2 PASS  — all 145 tools dispatch with real args (ok or honest refusal, zero unknown, zero crash)
v1118-profiles-honesty + v1118-no-tool-slicing
+ v1116-capability-guide + v1121-mcp-truth
+ v1121-skills-crash ...................... 38/38 PASS
```

### 2.3 What G2 actually proved (not simulated)

- **Skill**: the workspace skill `guard-skill` was discovered, injected into the
  system prompt, called via `use_skill`, returned its real body marker
  `GUARD_SKILL_BODY_MARKER_9F3`, and the model echoed that marker in its final answer.
- **Core tool**: `run_command {node -e "console.log('CORE_TOOL_MARKER_9F3')"}` ran for
  real (exit 0), the marker appeared in the `tool_result`, was fed back into the
  model transcript, and appeared in the final answer.
- **MCP tool**: `mcp__demo_v1126__echo` reached a **spawned stdio MCP server**,
  which physically recorded the call in a receipt file and returned
  `echo:MCP_TOOL_MARKER_9F3`; the engine surfaced it as a `tool_result` and the
  model echoed it.
- **Ledgers on disk**: durable journal (`journals/<date>/<session>.jsonl` with all
  three tool names + `finish`), trace (`traces/<date>/trace-*.jsonl` with all three
  tool names + footer), `skill-promotions.json`, the proof package under `proofs/`,
  the `false_done` + `proof_package` events, and the MCP registry call counter (≥1).
- **Slash commands**: 44 advertised commands, **0 without a handler**, **0 TODO/no-op**
  handlers; engine-side dispatch verified at runtime for `/plan`, `/build`, custom
  commands with `$1`/`$ARGUMENTS` expansion, and the unknown-command notice.

---

## 3. الفشل الدقيق / Exact failures (do NOT fix source — report to parent)

| # | Check | Observed | Expected | Exact location |
|---|-------|----------|----------|----------------|
| F1 | `CapabilityGuide advertises the LIVE balanced count (120)` | guide says **119** | **120** | `src/components/CapabilityGuide.tsx:130` (`count: '119'`) — also `:160` (EN copy) and `:161` (AR copy) |
| F2 | `WhatsNew advertises the LIVE balanced count` | says **119** | **120** | `src/components/WhatsNew.tsx:26` (EN), also `:25` (AR) |

Live registry truth, measured from the bundled `defsForProfile(CORE_DEFS, profile)`:

```
CORE_DEFS = 145   essential = 40   balanced = 120   full = 145
```

`ADVANCED_TOOL_NAMES` currently hides 25 deep-specialist tools from `balanced`
(145 − 25 = 120). The UI copy was never updated from 119 → 120. This is a
**documentation/advertising defect only** — no tool is missing, deleted, or broken.

### False positives investigated and ruled out (honesty note)

- `electron/agent/engine.ts:585` contains
  `` `Available tools include: ${tools.slice(0, Math.min(14, tools.length)).join(', ')}… and more.` ``
  This is a **display truncation in a prompt sentence**, not a removal from the
  `tools:[]` array. The guard deliberately excludes `.slice(0,N).join(...)`
  display lines; a real tool-list truncation would still fail G1a.
- The first G2 observation showed `skill-usage.json` empty. A concurrent edit by
  the skills agent (the `touchSkillUsage()` hook in `electron/agent/tools.ts:2835`)
  fixed it; the final run passes. The MCP tool name in the harness was initially
  derived from the server **id** instead of its **name** — that was a harness bug,
  corrected to `mcp__demo_v1126__echo`; it was never a source defect.

---

## 4. الحكم الصريح / Blunt verdict

### العربية

**الأدوات نفسها حقيقية ومستخدَمة فعلاً — لا توجد قدرة وهمية في التنفيذ.**
١٤٥ أداة مسجّلة، و١٤٥/١٤٥ منفّذ قابل للاستدعاء (لا `Unknown tool`، لا انهيار)،
واختبار التغطية الكامل بوسائط حقيقية نجح. تشغيل المحرك الحقيقي نجح في استدعاء
أداة أساسية ومهارة وأداة MCP في نفس التشغيل، ووصلت نتائج الثلاثة إلى الإجابة
النهائية، وكُتبت السجلات فعلياً على القرص. كل أوامر الشرطة المائلة المعلَنة
(٤٤ أمراً) لها معالج حقيقي، ولا يوجد معالج فارغ أو TODO.

**لكن الطبقة الإعلانية لا تزال جزئياً تجميلية (cosmetic):** واجهة «دليل الإمكانيات»
و«ما الجديد» تقolan إن ملف «متوازن» يعرض ١١٩ أداة بينما الرقم الحقيقي ١٢٠.
رقم خاطئ في مكانين — لا يغيّر قدرة، لكنه يثبت أن ادعاءات الواجهة لم تُطابق
السجل الحيّ حتى هذه اللحظة.

**الحكم:** *قابلة للاستخدام فعلاً من الناحية الوظيفية؛ لا تزال فيها لمسة تجميلية
واحدة في الأرقام المعلَنة.* يُنصح بتصحيح «119» إلى «120» في
`CapabilityGuide.tsx:130,160,161` و`WhatsNew.tsx:25,26` — تحرير نسخ فقط، بلا أي
تغيير في منطق الأدوات.

### English

**The capabilities themselves are real and genuinely exercised — there is no
cosmetic tool in the implementation.** 145 tools are registered, 145/145 have
reachable executors (no `Unknown tool`, no crash), and the full real-args coverage
suite passes. A real engine run called a core tool, a skill (`use_skill`) and an
MCP tool in one turn, all three results reached the final answer, and the ledgers
(journal, trace, skill promotions, proof, MCP call counter) were physically
written. All 44 advertised slash commands map to real handlers; zero no-op/TODO
handlers.

**But the advertising layer is still partly cosmetic:** the Capability Guide and
What's-New screens claim the `balanced` profile shows **119** tools while the live
registry yields **120**. Two wrong numbers do not disable a capability, but they
prove the UI claims were not reconciled with the live registry at this point.

**Verdict:** *Functionally usable for real — with one remaining cosmetic residue
in the advertised numbers.* Fix `119` → `120` in
`src/components/CapabilityGuide.tsx:130,160,161` and `src/components/WhatsNew.tsx:25,26`
(copy-only; no tool logic change).

---

## 5. ملاحظة للمشرف / Note to the parent agent

- This report is a **diagnosis**, not a fix. Application source was not touched.
- Re-run `node --test --test-force-exit tests/v1126-capabilities-guard.test.mjs`
  after the two copy fixes; G3a should then be green and the verdict becomes
  "ALL CAPABILITIES REALLY USABLE".
- If the live `balanced` count changes again (agents are still editing
  `tool-defs.ts`), re-measure before editing the copy — the guard asserts against
  the live number, not a hardcoded one.
