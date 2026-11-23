# SKILLS AUTO-USE — v1143 — الحكم الصريح / Blunt verdict

> Founder: «السكيلز اللي بضيفها بالسكيلز يجب أن استخدمها تلقائيا، فاهم علي؟ إنه جوا الهاي يستخدمها كليات.»
> Previous waves (v11.31/v11.36/v11.38) added a SKILLS-FIRST directive. The founder **still** said skills are not used. This wave traced the real path and fixed the real cause.

---

## 1. أين كان الانكسار فعليًا / Where it actually broke (traced end-to-end)

The path a user-added skill takes:

```
SkillsPanel (NewSkillForm, default scope = workspace)
  → api.skillsSave(ws, {...}, scope)          → <ws>/.surnia/skills/<slug>/SKILL.md
  → engine.runAgent: skillsIndexLine(ws, task)
  → buildSystemPrompt({ skills: [...] })       → "# SKILLS" section in system prompt
  → model calls use_skill(slug)
  → tools.ts useSkill() → loadSkill() → real body in tool_result
  → pushMessage(role:'tool_result')            → body in the NEXT provider request
```

Three real breaks, all **before** the prompt directive ever mattered:

1. **Trust gate hid the skill completely (the main cause).**
   `engine.ts` had `trusted = hasSkillsDir ? (workspaceSkillsTrusted(ws) || trust === 'always') : true`.
   The SkillsPanel saves new skills in **workspace** scope by default (`useState('workspace')`), so `hasSkillsDir` became `true`, while the default setting is `trust = 'ask'` and the `.surnia/skills-trusted` marker does **not** exist. Result: `skillsIndex` stayed `''` → the skill was **absent from the next system prompt** → the model could not call `use_skill` for something it never saw. The founder had no idea an obscure trust marker was required.

2. **Selective injection hid it a second time.**
   `skillsIndexLine(ws, currentTask)` filters to task-matched skills (`matchSkillsForTask`, score ≥ 3, domain evidence). A user skill whose name/description did not overlap the task keywords was dropped even when trusted.

3. **Directive was low-salience, and there was no fallback.**
   The SKILLS-FIRST rule said "when a skill is *relevant* … call use_skill". A weak/local model read the list, decided relevance itself and improvised — no `use_skill`, no body, no compliance. Nothing at harness level guaranteed the user's instructions reached the model.

**Verdict (old):** Adding a skill did **not** reliably make the AI use it. The founder was right; the previous SKILLS-FIRST text was treating the symptom, not the cause.

---

## 2. الإصلاح / The fix (v1143)

### (a) ALWAYS advertised — trust gate no longer hides user-added skills
- `engine.ts` now calls `skillsIndexLine(workspace)` with **no task filter** → every non-quarantined skill (workspace / global / builtin) is in the next system prompt.
- Trust no longer suppresses the index. Poison/quarantine (from `skillGate`) is still enforced inside `skillsIndexLine()` / `matchSkillsForTask()`, so a malicious skill is never offered.
- `trust === 'never'` now means only: "do not **auto-inject workspace-scope bodies**" — the skill is still advertised, and global (user-installed) skills still qualify.

### (b) Directive prioritises the user's skill explicitly
- `prompts.ts` SKILLS section (dynamic tail only) now states: a skill the user added in the Skills panel is an **EXPLICIT USER INSTRUCTION** — **load the user's skill FIRST** and **follow ALL its steps literally**; a partial read or improvised substitute is a failure.
- The original v11.36 wording (`use_skill`, `skills given by the user`, `MUST call use_skill`, `BEFORE you plan, answer, edit files or improvise`) is preserved so the older regression suite stays green.

### (c) Traced — real run proves use_skill and body delivery
- `engine.ts` emits a distinct `trace.step({ name: 'skill:auto-used' })` **when the model dispatches use_skill** (never for a harness injection), plus a confirmed-delivery trace with `slug`, body length and a body SHA-1, and a `sys_notice { kind: 'skill:auto-used' }`.
- `tests/v1143-skills-auto.test.mjs` drives the real engine with a scripted provider and asserts the body reaches a later provider request.

### (3) SOFT harness injection when the model won't call it — kept honest
- `buildAutoSkillInjection()` picks the **single most relevant user skill** (global/workspace, never builtin) via the same honest task matcher used for the index, loads its real body and passes it to `buildSystemPrompt({ injectedSkill })`.
- The prompt label is blunt: **"HARNESS-INJECTED USER SKILL (soft injection — NOT a model use_skill call)"** and instructs the model to follow all steps while **not** claiming a tool call happened.
- A `sys_notice { kind: 'skill:auto-injected' }` tells the renderer the harness did it. There is **no** `skill:auto-used` event/trace unless the model really called the tool.

### UI
- `SkillsPanel.tsx` gained an honest bilingual AUTO-USE info line: every skill added here is advertised next run, the most relevant is loaded first and all steps followed; **USE** forces a specific skill.

---

## 3. تحقق / Verification (actually run)

| Test | Result |
|---|---|
| `tests/v1143-skills-auto.test.mjs` (5 tests, real engine + scripted provider) | ✅ pass — untrusted user skill advertised + soft-injected; no false "used" claim; real `use_skill` traced + body in later request; `never` still advertises; caps stable |
| `tests/v1131-skills.test.mjs` | ✅ 8/8 pass |
| `tests/v1136-skills.test.mjs` | ✅ 7/7 pass |
| `tests/v1138-prompts-skills.test.mjs` | ✅ 7/7 pass |
| `tests/v1123-skills-lsp.test.mjs` | ✅ all pass (selective index still computed, now bounded + used as the soft-injection candidate whitelist) |
| `tests/v1116-prompt-cache.test.mjs` | ✅ 11/11 pass |
| `tests/v1135-token-savings.test.mjs` | ✅ 7/7 pass |
| `npx tsc -p tsconfig.node.json --noEmit` | ✅ clean (electron code) |

**Intentional supersession (blunt):** `tests/v1126-skills-use.test.mjs` case 3 asserts
`untrusted workspace → NO skill in the system prompt`. That is **exactly** the
behavior the founder ordered removed in this wave («السكيلز اللي بضيفها … يجب أن
يستخدمها تلقائيا»). It is impossible to both hide an untrusted user-added skill and
advertise it on the next run, so that single assertion is now obsolete and fails by
design (the other 4 cases in that file pass). The correct next step for whoever owns
that test file is to flip case 3 to assert the v1143 contract: advertised always,
body auto-injection gated only by quarantine + `trust: 'never'`. I did not edit it
because this wave owns only `prompts.ts` / `engine.ts` / `SkillsPanel.tsx` + its new test.

Byte caps: the SKILLS section and the soft injection live **only in the dynamic tail**; the no-skill EN base prompt is unchanged (<24 KB), so `v1116-prompt-cache` / `v1135-token-savings` stay exactly green.

---

## 4. الحكم النهائي / Final verdict

**EN:** The founder's complaint was valid. The skill was created correctly but was invisible to the model because an unwritten trust marker and a task-keyword filter removed it from the system prompt, and no harness fallback existed for models that ignore the directive. v1143 removes both suppressions, hardens the directive into an ALL-STEPS user instruction, injects the top user skill's real body as a clearly-labelled harness fallback, and traces real `use_skill` calls separately from harness injections. A skill the user adds is now advertised on the very next run and its instructions reach the provider — with honest accounting of who loaded it.

**AR:** شكوى المؤسس كانت صحيحة. السكيلز كان يتم حفظها لكنها لا تصل للنموذج إطلاقًا: علامة ثقة غير معروفة + فلترة حسب الكلمات كانتا تحذفانها من نظام البرومبت، وما كان فيه أي بديل على مستوى المنظومة للنماذج الضعيفة. الإصدار v1143 يزيل الحاجزين، ويحوّل التوجيه إلى أمر مستخدم صريح «حمّل سكيلز المستخدم أولًا ونفّذ كل الخطوات»، ويحقن جسد أنسب سكيلز للمستخدم كبديل مُوسوم بوضوح، ويسجّل استدعاء `use_skill` الحقيقي منفصلًا عن حقن المنظومة. النتيجة: أي سكيلز يضيفه المستخدم يظهر في البرومبت في التشغيل التالي وتصل تعليماته للمزوّد — مع صدق كامل فيما إذا كان النموذج قد استدعاه فعلًا أم لا.

---

## 5. الملفات المعدّلة / Files changed

- `electron/agent/prompts.ts` — SKILLS-FIRST directive area only (+ `injectedSkill` opt, dynamic-tail rendering).
- `electron/agent/engine.ts` — skill injection gate + `buildAutoSkillInjection` + use_skill execution tracing.
- `src/components/panels/SkillsPanel.tsx` — honest AUTO-USE info line.
- `tests/v1143-skills-auto.test.mjs` — new real-engine verification suite.
- `docs/SKILLS-AUTO-V1143.md` — this document.

**Not touched:** `tools.ts`, `store.ts`, `i18n.ts`, `providers.ts`, byte-stable static prefix, DEEP WORK / CAPABILITY ROSTER / DNA sections.
