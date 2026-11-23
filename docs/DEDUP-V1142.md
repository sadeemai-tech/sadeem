# DEDUP DECISION V1142 — diagnosis of "look-alike" features
# قرار التنظيف V1142 — تشخيص الميزات المتشابهة

> **Scope / النطاق:** Diagnosis + documentation ONLY. **No source file was edited by this wave.**
> الأب ينفّذ بعد التقرير. التاريخ: 2026-11-22. المصادر: قراءة مباشرة (read-only) للملفات أدناه
> داخل هذه الشجرة، plus the earlier decision record `docs/SIGNATURE-DECISION-V1140.md`.
>
> **Honesty note / ملاحظة صدق:** لم أشغّل البناء أو الاختبارات؛ هذا تشخيص ساكن بالكود.
> Where a claim comes from an older doc rather than a fresh read, it is labelled as such.

---

## 0. CONCRETE DECISION TABLE / جدول القرارات

| # | Feature / الميزة | What it REALLY is (file:line) | Verdict | Decision / القرار |
|---|---|---|---|---|
| 1 | **Living Playbook** | Real self-updating files + prompt injection: `electron/agent/playbook.ts:200-203,478-551,565-584,617-641`; engine inject at `engine.ts:3027-3042`; render at `prompts.ts:1001-1003`; tests `tests/v1112-playbook.test.mjs:49-68` | **REAL** (not decorative) | **KEEP.** Do not merge into DNA. At most rename the toast/copy so users know it is workspace memory. |
| 2 | **Trajectory Replay** | Pure 3-ledger reconstruction: `signatureFeatures.ts:197-374`; UI `SignaturePanel.tsx:70-123,287-330` | **REAL + DISTINCT** | **KEEP.** Genuinely unique; no other panel reconstructs a run step-by-step. |
| 3 | **DNA Autopsy → "DNA Insights"** | Still a 3rd tab of `SignaturePanel` (`SignaturePanel.tsx:31-34,245,248-252,332-358`), reading the same `useStore(s=>s.dna)`; engine `signatureFeatures.ts:472-500,516-628` | **REAL ENGINE / DUPLICATE UI** | **MERGE properly or DELETE the tab.** v1140 renamed it but did **not** move it into `DnaPanel` (see §2). Keep `promptVisibleIds()` either way. |
| 4 | **Capability Compass** | Real 145-tool inventory scoring: `signatureFeatures.ts:642-828`; UI `SignaturePanel.tsx:360-445` | **REAL + DISTINCT** | **KEEP.** No overlap with the Usage panel (which counts tokens/cost, not intent→tool routing). |
| 5 | **"Run Intelligence" rail name** | `i18n.ts:3117`, `registry.tsx:88` (v11.40 comment) | **DONE** | **KEEP the name**, but fix the tab naming (§2) or the name promises clarity the rail does not deliver. |
| 6 | **Skills "Marketplace"** | Real bundled catalog + real file copy: `skills.ts:226-288`, catalog `electron/assets/skills/marketplace.json`, IPC `ipc.ts:114-117`, UI `SkillsPanel.tsx:879-945` | **REAL — NOT DEAD** | **DO NOT call it vestigial.** If clutter is the problem, fold it into one "Add skill" menu; do not delete working install/remove. |
| 7 | **Skills "Import from another…"** | Real rival-skill harvest, security allowlisted: `register.ts:899-924`, `skills.ts:1296+`, UI `SkillsPanel.tsx:686-707,960-1004` | **REAL — NOT DEAD** | **MERGE with the existing MCP "Import from installed agents"** (`i18n.ts:2707`, `McpSection.tsx:159,377`) into ONE importer surface, or hide behind settings. |
| 8 | **"HIGH" / "هاي" (DNA vs HIGH)** | **No such feature found** anywhere in `src/`, `electron/`, `shared/`, `tests/`, `docs/` | **UNKNOWN — cannot verify** | **ASK THE FOUNDER to clarify.** Do not remove or invent anything (§4). |
| 9 | **"Two agent / Three agent"** | No literal feature. What exists: `task` tool → one specialist per call (`tool-defs.ts:312-327`, 16 specialists `agents.ts:31-190`); `background:true`; critic gate `shared/types.ts:1081-1082`; Subagents rail `registry.tsx:66,113,136` | **NO SUCH NAMED FEATURE** | **KEEP the subagent system** (core). Explain/clarify; do not delete on a hunch (§5). |
| 10 | **Agent-count user setting** | **Does not exist.** `AppSettings.agent` `shared/types.ts:1055-1088` has no count; UI `AgentSection.tsx:78-82,196-207` has none; hard-coded ceiling `engine.ts:987` (=64, background only) | **MISSING** | **ADD** `agent.maxSubagents` + wire it into engine and the uncapped parallel-batch path (§6). |
| 11 | **Wiki rail vs Library rail** | Both render `LibraryPanel`: `registry.tsx:130-134` (wiki = `initialTab="wiki"`), both listed in `STAGE_RAILS` `:111` | **DUPLICATE** | **Keep one page, one rail.** Remove `wiki` from the rail list; keep Wiki as a Library tab. |
| 12 | **Library vs Artifacts** | Library = cross-session produced files (`LibraryPanel.tsx:1-6`); Artifacts = per-session proof + HTML proof export (`ArtifactsPanel.tsx:1-7`) | **DISTINCT** | **KEEP both**; rename rail label "Artifacts → Proof/الدليل" if the names confuse. |
| 13 | **Sessions vs Trajectory Replay** | Sessions = list of runs; Replay = deep reconstruction of one run from 3 ledgers | **PARTIAL OVERLAP** | **KEEP both**, add a "Replay this run" deep link from SessionsPanel (props seam at `SignaturePanel.tsx:172-176`). |

---

## 1. PLAYBOOK — is it a real feature? / هل الدليل الحي ميزة حقيقية؟

**AR — الحكم: حقيقية بالكامل (REAL)، ليست ديكورًا.** الدليل يكتب ملفات فعلية على القرص:
`PLAYBOOK.md` و`playbook.json` و`playbook-history.json` داخل `.surnia/`، وكل تحديث يرفع رقم
الإصدار ويضيف مراجعة (revision) مع diff. المحتوى يُحقَن فعليًا في system prompt الخاص بالتشغيل
التالي عبر المسار الكامل: `playbook.ts` → `engine.ts` → `buildSystemPrompt()` → القسم الديناميكي.
فيه IPC مسجّل وواجهة bridge واختبارات offline تتحقق من الكتابة والتاريخ والحقن.

**EN — Verdict: REAL, fully wired, not decorative.**

- **Writes (real fs):** `playbook.ts:200-203` (`fsSync.writeFileSync`, mode `0o600`); `:478-551`
  `applyPlaybookUpdate()` writes state + markdown + history; `:565-584` `learnPlaybook()` is the
  fire-and-forget post-run writer and also refreshes cumulative memory.
- **Reads/legacy:** `:216-253` `loadPlaybook()` / sidecar-first read with markdown fallback;
  `:255-278` parses a human-edited `PLAYBOOK.md` back into items.
- **Prompt injection:** `engine.ts:3027-3042` renders and passes `playbook:` into
  `buildSystemPrompt()`; `prompts.ts:61` option, `:972-1005` injects
  `# Living Playbook (learned from runs in this workspace)` into the **dynamic tail**;
  `:107-110` `playbookCarriesMemory()` dedupes the second memory injection.
  `playbook.ts:345-412` `renderPlaybookPrompt()` caps the section at ~2000 chars and rides along
  cumulative memory (`:389-396`) + continuity block (`:397-405`).
- **IPC/UI:** `ipc.ts:51` `initPlaybookIpc()`; `playbook.ts:617-641` (`kdx:playbook:get/history/
  markdown/clear/update` + `kdx:playbook:event`); `preload.ts:382-387`; toast at
  `engine.ts:4572-4590` (`playbook_learned`).
- **Tests:** `tests/v1112-playbook.test.mjs:3-6,49-68` explicitly assert real files exist and
  contain the learned lesson (further cases cover history/dedupe/clear).

**Recommendation / التوصية:** **KEEP as-is.** It overlaps *conceptually* with DNA (both inject
advisory learned context) but they are different stores with different write paths — DNA is per
**user** (`dna.json`), playbook is per **workspace** (`PLAYBOOK.md`). Merging them would destroy
that distinction. If the founder still finds it confusing, the cheap fix is naming/copy only:
call it "workspace memory" in the UI; do **not** rip out the engine.

---

## 2. RUN INTELLIGENCE — three instruments: distinct or overlapping?
## ٢. استخبارات التشغيل — ثلاث أدوات: منفصلة أم متكررة؟

### 2.1 What v1140 actually did / ما الذي فعله v1140 فعلًا

**Honest correction to the brief / تصحيح صريح للمعطى:** the founder was told v1140 "moved
Autopsy → DNA Insights and renamed the rail". Only the **rename** happened in this tree:

- Rail renamed: `i18n.ts:3117` `'rail.signature': ['Run Intelligence', 'استخبارات التشغيل']`;
  `registry.tsx:88` fallback `'Run Intelligence' // v11.40`.
- Tab renamed: `SignaturePanel.tsx:31-34` comment — *"the middle view is no longer a separate
  'autopsy' concept: it is DNA Insights … **Kept here (not duplicated in DnaPanel)** to preserve
  one source of truth"*; tabs at `:248-252` are `REPLAY / DNA INSIGHTS / COMPASS`;
  the render block is still `:332-358` of `SignaturePanel`.
- `DnaPanel.tsx` was searched for `DNA Insights / رؤى الحمض / insights / autopsy` → **no matches**.
  There is no DNA Insights section in the DNA rail.

So today the rail called **"Run Intelligence"** contains a tab called **"DNA Insights"** that is
**not inside DNA** — that is worse for clarity than the old name "Autopsy", and it is exactly the
confusion the founder is describing. / الوضع الحالي: شريط باسم «استخبارات التشغيل» فيه تبويب
باسم «رؤى الحمض» خارج صفحة الحمض النووي — وهذا أكثر إرباكًا من الاسم القديم.

### 2.2 Are the three distinct? / هل الأدوات الثلاث منفصلة؟

| Instrument | Adds what nobody else does | Evidence | Verdict |
|---|---|---|---|
| **Trajectory Replay** | Rebuilds ONE run step-by-step by joining **3 real ledgers**: session messages (real tool args/output), JSONL journal (real `ms` durations), traces (real `chars`). Flags `unpairedResult` instead of inventing a pairing. | `signatureFeatures.ts:197-374`; `SignaturePanel.tsx:70-123,287-330` | **DISTINCT — KEEP** |
| **Capability Compass** | Scores the **real 145-tool inventory** against a typed intent, mines "do not use X → use Y" routing hints from the tool descriptions, joins with real call counts (`called/inventory/percent`), names unused capabilities. | `signatureFeatures.ts:642-828`; `SignaturePanel.tsx:360-445` | **DISTINCT — KEEP** |
| **DNA Insights (ex-Autopsy)** | For each **stored** `dna.json` fact: confidence + stored confidence rule + real evidence by token overlap + `promptVisibleIds()` — whether it will be injected in the next prompt. | `signatureFeatures.ts:472-500,516-628`; `SignaturePanel.tsx:126-170,245,332-358` | **ENGINE DISTINCT / UI DUPLICATE** — reads the same `dna` object `DnaPanel.tsx` renders; see `docs/SIGNATURE-DECISION-V1140.md:91-108` (prior-wave evidence) |

All three are **pure functions**: no LLM call, no file write, no new IPC; empty stores return
explicit codes (`NO_LEDGER_DATA`, `NO_DNA_LEARNED`, `EMPTY_INTENT`), never sample rows
(`docs/SIGNATURE-DECISION-V1140.md:33-36`). Nothing here is fake — the problem is *placement*.

### 2.3 Decision / القرار

1. **KEEP Replay + Compass.** They are genuinely unusual in this exact form and overlap nothing
   else in the app. (Do not claim they are "the only features in the industry" — session
   timelines exist elsewhere; our specific 3-ledger join and real-inventory compass are ours.)
2. **Resolve the DNA Insights duplication — pick ONE:**
   - **(A) Preferred, matches the v1140 intent:** actually **move** the `FindingRow` UI
     (`SignaturePanel.tsx:126-170`) + section (`:332-358`) into `DnaPanel.tsx` as a collapsible
     *"DNA Insights / رؤى الحمض"* section next to the patterns; keep `autopsyDNA()` and
     `promptVisibleIds()` in `signatureFeatures.ts` untouched, and leave only **2 tabs** in
     `SignaturePanel` (`REPLAY`, `COMPASS`). Reuse `useStore(s=>s.dna)` — no second load, no new IPC.
   - **(B) Cheaper:** delete the `insights` tab and its UI, keep `promptVisibleIds()` and surface
     its "in next prompt" badge inline in the existing DNA patterns table.
   - **Reject** keeping a third tab called "DNA Insights" outside DNA, and **reject** deleting the
     engine value (`LEGACY_CONFIDENCE`, evidence links, prompt-visibility proof) with the UI.
3. Keep `SIGNATURE_FEATURES` manifest (`signatureFeatures.ts:831-835`) as the engine list; add a
   `ui` field if you want it to describe homes — tests read this manifest
   (`docs/SIGNATURE-DECISION-V1140.md:134-138`).

---

## 3. SKILLS — "Marketplace" and "Import from another…" / السوق والاستيراد من وكلاء آخرين

**AR — الحكم: كلتاهما تعملان فعلًا (REAL)، ليستا أثرًا ميتًا.** لكن هناك **ثلاث طرق** لإضافة
مهارة في نفس الصفحة، وهذا هو الازدحام الحقيقي: «استيراد مجلد مهارة» + «استيراد من وكلاء آخرين»
+ «السوق». والاستيراد من الوكلاء مكرر كمان في إعدادات MCP.

**EN — Verdict: both are REAL and functional; the problem is three competing "add skill" entry
points plus a duplicate importer in MCP settings.**

- **Marketplace is real:** `electron/agent/skills.ts:226-288` — reads
  `builtinSkillsRoot()/marketplace.json` (catalog exists: `electron/assets/skills/marketplace.json`),
  `installMarketplaceSkill()` copies the bundled `SKILL.md` into `<userData>/skills/<slug>/`
  (global scope, real `fs.writeFile`), `removeInstalledSkill()` really removes it. IPC:
  `ipc.ts:114-117`; preload `preload.ts:177-180`; UI `SkillsPanel.tsx:879-945` (list/install/
  remove + honest error/empty states and i18n keys `skills.market.*`, `i18n.ts:3844,3851,4025`).
- **Import from another agent is real:** `electron/agent/register.ts:899-924` registers
  `kdx:rivals:skills` / `kdx:rivals:skills-import` with a **security allowlist** — `srcRoot` must
  be one of the detected rival roots or it returns `{imported:0}`; real harvest at
  `skills.ts:1319` (`detectRivalSkills`) / `:1358` (`importAllSkillsFrom`); preload `preload.ts:108-112`; UI
  `SkillsPanel.tsx:686-707,960-1004` with real result counts (`skills.rivals.imported`,
  `i18n.ts:2718-2723`).
- **Third path:** "Import skill folder" (`i18n.ts:1950`, `SkillsPanel.tsx:775`,
  `api.skillsImportDir` `api.ts:420`) — also real.
- **Duplicate elsewhere:** `settings.mcp.importRivals` "Import from installed agents"
  (`i18n.ts:2707`, `McpSection.tsx:159,377`) imports MCP servers from the **same rival agents**.
  Two different settings surfaces do "import from rivals" for two different data types — this is
  the confusing part.

**Recommendation / التوصية:**
- **Do not delete them as "dead"** — that would remove working install/import code and break the
  i18n/IPC contract; the tests/handoff would need cleanup too.
- **Reduce clutter instead:** collapse the three skill-add actions into one `+ Add skill` menu
  (Import folder / Marketplace / From other agents), and move the rival-import entry next to the
  MCP rival import in Settings (or make one shared "Import from other agents" dialog that imports
  **both** skills and MCP). If the founder insists on removal, remove the UI + i18n keys +
  IPC gates deliberately — and record that real functionality was removed, not dead code.

---

## 4. DNA vs "HIGH" / الحمض النووي مقابل «هاي»

**AR — الحكم: لم أجد أي ميزة باسم HIQ / H-IQ / High Intelligence / «هاي» في الكود.**
بحثت في `src/` و`electron/` و`shared/` و`tests/` و`docs/`؛ النتائج كانت مطابقات خاطئة فقط
مثل «نها**ية**» أو `high-contrast`. **لا أستطيع تأكيد وجودها، ولن أختلق تعريفًا لها.**
الرجاء توضيح المقصود بـ«هاي» قبل أي حذف.

**EN — Verdict: UNKNOWN / NOT VERIFIABLE. Be honest: no feature by that name exists in this tree.**

Nearest real candidates (do **not** assume the founder meant any of them):

| Candidate | Evidence | Note |
|---|---|---|
| High-contrast theme | `shared/types.ts:981-983` (`theme: … \| 'high'`) | UI theme, unrelated to DNA |
| Deep effort / deep work | `shared/types.ts:1066`, `prompts.ts:741-749`, `engine.ts:3039` | step budget + thinking-first directive |
| Named reasoning effort values (`high`, `max`, `minimal`) | `shared/types.ts:1067-1074`, `docs/EFFORT-PER-MODEL-V1138.md` | model-side stop value, not a DNA feature |
| DNA rail itself | `registry.tsx:79`, `DnaPanel.tsx` | verified working; `DNA-GUARD-V1127.md`, `DNA-RELFIX-V1135.md` exist |

**Decision: ASK, don't guess.** Parent should ask the founder one clarifying question
("هاي = high-contrast؟ deep effort؟ شيء ثالث؟") before touching anything.

---

## 5. "TASK AGENT" / "THIRD AGENT" / الوكيل الثاني والثالث

**AR — الحكم: لا توجد ميزة بهذا الاسم أصلًا.** الذي موجود فعلًا:
- أداة `task` تُرسل مهمة إلى **أخصائي واحد** لكل استدعاء من قائمة 16 أخصائيًا —
  `tool-defs.ts:312-327` (`agent`, `description`, `prompt`, `background`)؛
  القائمة `agents.ts:31-190`؛ نص واجهة `i18n.ts:1086` «16 specialist agents».
- وضع `background:true` → وكيل خلفي fire-and-forget (`engine.ts:7140-7184`).
- لوحة الوكلاء الفرعيين (rail 15) `registry.tsx:66,113,136` + حالة
  `store.ts:851-852,914-925,4813-4863` + `SubagentsPanel`.
- «الوكيل الإضافي» الأقرب لفكرة «الثالث»: بوابة النقد العدائي `criticGate`
  (`shared/types.ts:1081-1082`) وأدوار النماذج `modelRoles` (`shared/types.ts:1083-1084`).

**EN — Verdict: NO literal "task agent"/"third agent" feature exists.** There is a `task` tool
that spawns **one specialist per call** from a fixed 16-agent roster, optional background mode, a
subagents dashboard, and an optional adversarial critic/model-role router. "Two agent / three
agent" is most plausibly the founder's shorthand for these multiple agent passes — but that is an
**inference**, not a verified feature name.

**Decision / القرار:**
- **KEEP** the task tool and subagent system — they are core, working, and separately guarded
  (`docs/AGENT-DRILL-V1135.md`, `docs/SUBAGENT-TOOLS-GUARD-V1136.md`, `tests-v1135-agent-drill-guard.mjs`).
- If the complaint is *crowding*, the fix is the **agent-count setting (§6)** plus clearer copy —
  not deleting the subagent rail (which is also the visible proof that subagents work).
- Ask the founder which screen showed "two agent / three agent" before any removal.

---

## 6. AGENT-COUNT SETTING — does it exist? / هل يوجد إعداد لعدد الوكلاء؟

**AR — الحكم: غير موجود (MISSING)، والسقف الحالي مخفي في الكود وغير متسق مع الوصف.**
`AppSettings.agent` لا يحمل أي حقل لعدد الوكلاء، وشاشة إعدادات الوكيل تعرض
«أقصى دورات» وتوازي الأدوات… بلا عدد وكلاء. السقف الوحيد هو ثابت `64` للمسار الخلفي فقط،
والمسار المتوازي بلا سقف إطلاقًا، ونص أداة `task` يقول «max a few concurrent» — تناقض صريح.

**EN — Verdict: MISSING, and the hard-coded state is inconsistent.**

- `shared/types.ts:1055-1088` — `AppSettings.agent` has `maxTurns`, `parallelToolCalls`,
  `maxRetries`, `effort`, `criticGate`, `modelRoles`… **no `maxSubagents` / `maxAgents`**.
- `src/components/settings/AgentSection.tsx:78-82` (defaults: `maxTurns:40`, `parallelToolCalls:true`)
  and UI at `:196-207,279-280` — no agent-count control.
- `src/components/settings/registry.ts:94-105` — agent settings index has no count entry.
- Hard ceiling: `engine.ts:987` `const BACKGROUND_SUBAGENT_CAP = 64;`; enforced only at
  `:7171-7177` in `runBackgroundSubagent()`. `:980-987` says the founder wanted "agents have no
  set limit", so 64 is a runaway-protection ceiling, not a product setting.
- The **parallel-batch path has no cap at all** (`engine.ts:985`).
- Stale copy: `tool-defs.ts:325` still says *"max a few concurrent"* while the code allows 64.

**Recommendation — where to add it / أين تُضاف:**
1. `shared/types.ts` in `AppSettings.agent` (~`:1055-1088`): `maxSubagents?: number` (range 1–16,
   default e.g. 4; document that it is a concurrency cap for **background** subagents, not a ban
   on the 16-specialist roster).
2. `src/components/settings/AgentSection.tsx` near `maxTurns` (`:196-207`) — a numeric field;
   add i18n `settings.agent.maxSubagents(.hint)` near `i18n.ts:1374-1380,1545-1547`, and an entry
   in `src/components/settings/registry.ts` near `:95`.
3. `engine.ts`: replace the literal at `:7171` with
   `Math.min(BACKGROUND_SUBAGENT_CAP, cfg.agent?.maxSubagents ?? DEFAULT_MAX_SUBAGENTS)`; apply the
   same limit to the parallel-batch path (currently uncapped at `:985`) so the setting is honest.
   Keep 64 as an absolute hard safety ceiling underneath the user value.
4. Fix `tool-defs.ts:325` copy to describe the real setting.

---

## 7. OTHER DUPLICATE / OVERLAPPING SURFACES / أسطح مكررة إضافية

| Pair | Evidence | Reality | Recommendation |
|---|---|---|---|
| **Wiki rail ↔ Library rail** | `registry.tsx:84,111,130-134` — `wiki:` renders `<LibraryPanel initialTab="wiki"/>`; both in `STAGE_RAILS` | **True duplicate rail** (two rail entries, one component) | Remove `wiki` from the rail list; keep "Repo Wiki" as a Library tab. Update `RAIL_NO`/`RAIL_TITLE` accordingly. |
| **Library ↔ Artifacts** | `LibraryPanel.tsx:1-6` (cross-session files) vs `ArtifactsPanel.tsx:1-7` (per-session proof + HTML export) | **Distinct**, only names confuse | Keep both; consider relabelling rail 09 to "Proof / الدليل". |
| **Sessions ↔ Trajectory Replay** | `registry.tsx:75,120` vs `SignaturePanel.tsx:287-330` | **Partial**: list-of-runs vs deep-replay-of-one-run | Keep both; add a "Replay this run" deep link (`SignaturePanelProps` seam at `SignaturePanel.tsx:172-176` accepts only `initialTab`/`initialIntent` — extend with `initialSessionId`). |
| **Three "add skill" paths** | `SkillsPanel.tsx:686-707,775,879-945` | **Real clutter** | Merge into one `+ Add skill` menu (§3). |
| **Rival import in Skills ↔ MCP** | `SkillsPanel.tsx:960-1004` vs `McpSection.tsx:159,377` | Same source concept, two surfaces | One shared importer dialog for skills **and** MCP. |
| **DNA ↔ Playbook ↔ Memory in prompt** | `prompts.ts:972-1005` injects all three advisory blocks; `playbook.ts:389-410` already carries memory + continuity | **Potential duplicate content**, already de-duped by `playbookCarriesMemory()` + exclude set (`playbook.ts:354-375`) | Keep the guards; do NOT add a fourth learned-context block. |

---

## 8. What this wave did NOT verify / ما لم أتحقق منه

- No build/typecheck/test run (read-only mandate). Test claims reference the test source, not an
  executed run.
- `DnaPanel.tsx` line references in §2.2 are quoted from the prior wave's
  `docs/SIGNATURE-DECISION-V1140.md:91-108`; this wave only re-verified that **no** DNA-Insights
  section exists there.
- The meaning of "هاي" and "two/three agent" could not be resolved from the repository —
  these require the founder's answer, not more code archaeology.
- I did not inspect every i18n key or CSS asset; only the paths needed for the decisions above.

**Bottom line / الخلاصة:** The app does not have a mass of dead duplicate features. It has
**one genuinely duplicated UI surface** (DNA Insights living outside DNA plus a duplicate Wiki
rail), **one naming lie** ("Run Intelligence" containing "DNA Insights"), **one missing setting**
(agent count), and **several working-but-cluttered entry points** (skills imports). Delete the
duplication and the clutter; keep the working engines — especially the Playbook.
