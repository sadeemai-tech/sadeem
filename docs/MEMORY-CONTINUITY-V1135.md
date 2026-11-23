# MEMORY CONTINUITY v11.35 — honest verdict / حكم صريح

> Founder: **"حل ذاكرة الذكاء الاصطناعي واستمراريته ... بطل يتعلم النموذج، خلص وقف على عدد معين، بطل يزداد، بطل يتحسن معي"**
> ("Fix the AI's memory and continuity ... the model stopped learning, stopped at a number, doesn't grow, doesn't improve with me.")

**Date / التاريخ:** 2026-11-21 · **Scope:** read-only audit + one new file + one new test + this doc.
No `store.ts`, `dna.ts`, `engine.ts`, `prompts.ts`, `ctx.ts`, `tools.ts`, `playbook.ts` or `memory.ts` was edited by this agent.
Line numbers are the ones observed at audit time; other agents are editing concurrently, so symbols are given alongside every line.

---

## 0. The blunt verdict / الحكم بلا تلطيف

### EN
**The AI already remembers across restarts — but only a slice. The founder's explicit "remember this" facts and pinned context do NOT. That is the real gap.**

| Claim | Verdict | Evidence |
|---|---|---|
| Compaction-derived memory (task, decisions, files, preferences, next steps) survives restart and reaches the next system prompt | ✅ **TRUE** | `.surnia/memory-snapshot.json` is re-read from disk and injected into the **dynamic** prompt tail. Proven by `tests/v1123-memory-audit.test.mjs` T2–T4 and `tests/v1131-learning.test.mjs` A2–A4 (both re-run GREEN this session). |
| `remember` (project/reference) facts survive restart and reach the next prompt | ❌ **FALSE — written but never injected** | `tools.ts:3376-3415` writes them to `MEMORY.md` `## Remembered`; `prompts.ts:952-961` **suppresses** `opts.memory` (which is where `MEMORY.md` arrives, `engine.ts:2418-2440`) whenever the playbook carries the `CUMULATIVE SESSION MEMORY` marker. `memory.ts:540-594` never reads `MEMORY.md`, so the facts are not folded into the snapshot either. |
| `pin_context` survives restart | ❌ **FALSE** | `contextStore.ts:49` is an in-memory `Map`; `contextStore.ts:38-41` clears pins at session end. It survives pruning/compaction **within** a session only (`engine.ts:4863-4881`, `engine.ts:5509-5512`). |
| `recall_memory` finds explicitly remembered project facts | ❌ **FALSE** | `dna.ts:926+` indexes session transcripts + DNA patterns only — not `MEMORY.md`, not the continuity store. |
| "Learning stops at a number" | ⚠️ **BOUNDED, not stopped** | Playbook 24/section (`playbook.ts:33`), DNA 60 (`dna.ts:53`), snapshot 1024/category (`memory.ts:51`), render 4000 chars (`memory.ts:56`). All evict **old+reinforced** first so a new fact is never silently dropped — but the **prompt never tells the model that learning continues**. Only the DNA block does (`prompts.ts:972-975`); the memory block does not. |

**After THIS work:** a single, honest, offline continuity layer exists (`electron/services/memoryContinuity.ts`) and is proven by 7 real tests. It is **not wired into the running app yet** — see the exact 3-call-site handoff in §5. Until those lines are added, the founder's complaint is **only partially fixed**, and I will not claim otherwise.

### AR
**الذكاء يتذكر فعلاً عبر إعادة التشغيل — لكن جزئيًا فقط. حقائق "تذكّر هذا" الصريحة والسياق المُثبَّت (pin_context) لا تُحقَن في الرسالة التالية. هذه هي الفجوة الحقيقية.**

- ✅ صحيح: ذاكرة الضغط (المهمة، القرارات، الملفات، التفضيلات، الخطوات) تصمد عبر إعادة التشغيل وتصل إلى ذيل النظام الديناميكي.
- ❌ خطأ: `remember` للمشروع يكتب في `MEMORY.md` ثم **يُكبَت** عند `prompts.ts:961` — مكتوب لكن غير مرئي للنموذج.
- ❌ خطأ: `pin_context` يعيش في `Map` داخل الذاكرة ويُمسح نهاية الجلسة (`contextStore.ts:38-41`).
- ⚠️ محدود لا متوقف: الحدود معلومة، لكن النموذج لا يُقال له "الwinDOW محدود والتعلم مستمر" سوى في قسم DNA.
- **بعد هذا العمل:** طبقة استمرارية صادقة جديدة + 7 اختبارات حقيقية، لكنها **غير موصولة بالتطبيق** بعد؛ تحتاج 3 تعديلات اسطر من الوكيل الأب (§5).

---

## 1. Audit — what survives restart / ما الذي يصمد

| Subsystem | Written where | Survives restart? | Reaches next system prompt automatically? | Exact location |
|---|---|---|---|---|
| Cumulative session memory | `<ws>/.surnia/memory-snapshot.json` + `memory-history.json` | ✅ Yes | ✅ Yes — rides inside the playbook body | `memory.ts:146-151`, `memory.ts:522-622`, `playbook.ts:341-398`, `engine.ts:2702/2715`, `prompts.ts:979` |
| Compaction carry-forward block | appended to `messages[0].text` | ✅ within session; on disk via snapshot | ✅ yes | `compaction.ts:218-236`, `engine.ts:5207-5215`, `engine.ts:5250-5252` |
| DNA (user identity/preferences/workflow) | `<userData>/dna.json`, `<ws>/.surnia/dna.json` | ✅ Yes | ✅ Yes — `# User DNA` + "already known, keep learning" | `dna.ts:558`, `prompts.ts:968-976` |
| Playbook (worked/failed/preferences/recipes) | `PLAYBOOK.md` + `playbook.json` + history | ✅ Yes | ✅ Yes (top 4 per section, `playbook.ts:362-364`) | `playbook.ts:33`, `playbook.ts:341-398`, `playbook.ts:551-570` |
| **`remember` → project/reference** | `MEMORY.md` `## Remembered`, capped 80 | ✅ file survives | ❌ **NO — suppressed by dedup guard** | `tools.ts:3324/3376-3415`, `engine.ts:2418-2440`, `prompts.ts:952-961` |
| **`remember` → user/feedback** | DNA via `recordAgentNote` | ✅ Yes | ✅ Yes (through DNA prompt) | `tools.ts:3362-3374`, `dna.ts:558` |
| **`pin_context`** | in-memory `Map` | ❌ **NO** | within session only | `contextStore.ts:48-103`, `engine.ts:4863-4881`, `engine.ts:5509-5512` |
| `recall_memory` | lazily built **in-memory** index over ≤200 session JSON files on disk | ✅ sources on disk; index rebuilt | ❌ on-demand tool only | `dna.ts:70-72`, `dna.ts:820+`, `dna.ts:926+` |
| `memory_verify` | `MEMORY.md` + `<ws>/.surnia/memory-index.json` | ✅ sidecar on disk | ❌ on-demand tool only | `tools.ts:4563-4632` |
| Checkpoints | git shadow commit / `<userData>/checkpoints/**` + manifest with `sessionId` | ✅ Yes | ❌ manual restore, not prompt continuity | `checkpointService.ts:1-10`, `checkpointService.ts:24-39` |
| Full profile export | portable JSON: settings + DNA + skills + prompts | ✅ Yes | n/a | `profileService.ts:31-40` — **contains no memory snapshot / continuity store** |

**The false promise in the code:** `tool-defs.ts:1037` tells the model that project/reference facts go to `MEMORY.md` and are *"visible to every future session here"*. Given `prompts.ts:961`, that is not true once the playbook carries its memory marker. This is precisely the "written but never surfaced" failure mode.

---

## 2. The real continuity gap / الفجوة الحقيقية

1. **Write/inject split (`remember` project).** `rememberTool` writes an entry to `MEMORY.md` (`tools.ts:3385-3414`). `engine.ts:2424` loads that file into `opts.memory`. `prompts.ts:952` sets `playbookHasMemory = playbookCarriesMemory(opts.playbook)`; because the playbook appends the cumulative-memory block (`playbook.ts:385-392`, marker literal at `memory.ts:741`), `memoryDuplicated` becomes true and `hasMemory` becomes false (`prompts.ts:958-961`). **The file is written every run and shown to the model never.** No cap is to blame — the dedup guard is.
2. **No snapshot ingestion of `MEMORY.md`.** `memorySnapshot()` merges playbook + DNA + journal + compaction summary (`memory.ts:540-594`) but never `MEMORY.md`. So the explicit remembers never even reach the one block that *is* injected.
3. **Eviction never surfaces.** Playbook `MAX_ITEMS=24` (`playbook.ts:33`), DNA `MAX_PATTERNS=60` (`dna.ts:53`), snapshot `MAX_STORED_FACTS=1024` (`memory.ts:51`). The eviction policy itself is honest (oldest+most-reinforced retires; new facts survive), but there is no `evicted` counter, no report, and no instruction telling the model "the window is bounded, old reinforced facts retire, keep recording new ones".
4. **Restart kills pins and the recall index.** `contextStore.ts:38-41`/`49` and `dna.ts:820`.

---

## 3. What was implemented / ما الذي نُفِّذ

**New file `electron/services/memoryContinuity.ts`** (the only source file created; Node builtins only, no electron import, no network, no model calls):

- **Durable disk stores with provenance + timestamps.** Project: `<workspace>/.surnia/continuity.json`. User: `<userDataDir>/continuity.json`. Atomic owner-only (`0600`) temp-file + rename write (`writeStore`); corrupt JSON degrades to an empty store, never throws.
- **`ContinuityFact`** carries `id`, `text`, `kind`, `scope`, `count`, `firstSeen`, `lastSeen`, `provenance`, `lastProvenance`, optional `source` — all real data, nothing invented.
- **Full-text dedup.** `normalizeContinuityText()` lowercases/space-normalizes the **entire** text; `continuityId()` hashes the full normalized string (`sha256`, 24 hex). Not a prefix, not a slice — unlike playbook's 56-char prefix. Two facts differing only in their tail are two facts.
- **Write / read / recall / forget / clear / stats** — `writeContinuityFact`, `readContinuity`, `recallContinuity`, `forgetContinuity`, `clearContinuity`, `continuityStats`. Every one is defensive and offline.
- **Exact repeats reinforce** (`count++`, `lastSeen` refresh, `lastProvenance` records the new writer; `firstSeen` never moves).
- **Honest bound.** `MAX_CONTINUITY_FACTS = 512` per scope; when full, one OLDEST + MOST-REINFORCED fact retires so a genuinely new fact is always kept. The `evicted` counter is persisted, and `writeContinuityFact().evicted` returns the **real retired text**, not a fabricated label.
- **Short prompt block.** `renderContinuityBlock()` merges user + project scopes and `renderContinuityFacts()` produces a header `WHAT I ALREADY KNOW (durable continuity — real writes, advisory)` + the explicit instruction *"These are ALREADY known — do NOT re-record them … old reinforced facts retire when new ones arrive, so learning never stops at a number"*. Newest-first ranking; the newest fact is **guaranteed** to survive even a pathological cap. Default `RENDER_CAP = 1_600` chars with a `… [continuity view truncated — full set on disk]` marker. Advisory only — never a rule, ban or permission.

### Honest limits / الحدود الصريحة
- 512 facts per scope on disk; 1,600 chars in the prompt view (truncation is marked).
- 2,000 chars per fact; text over that is rejected (`TEXT_CAP`).
- Recall is term-overlap, ≤16 hits, no embeddings/network — deliberately capability-neutral.
- This layer is **additive**: it does not delete or rewrite DNA/playbook/snapshot/MEMORY.md data.

---

## 4. Proof — real test, real files / الإثبات

`tests/v1135-memory-continuity.test.mjs` bundles the real TS module, writes real temp files, drops `require.cache` for a genuine fresh-module restart, and asserts the raw JSON bytes.

```
node --test --test-force-exit tests/v1135-memory-continuity.test.mjs
# tests 7 / pass 7 / fail 0
```

| Test | Proves |
|---|---|
| T1 WRITE | 3 distinct facts in raw `continuity.json` with `version:3`, provenance, `firstSeen`/`lastSeen`. |
| T2 RESTART | Fresh `require()` recalls all 3 facts; offline recall still finds them; stats report 3. |
| T3 DEDUP | Exact repeat → `action:'reinforced'`, `count:2`, no new row; tail-variant → `action:'added'`, distinct id; key = full normalized text. |
| T4 EVICTION | At 512: new fact kept, `V1135CAP_0000` retired, real retired text returned, `evicted:1` in raw bytes, size still 512. |
| T5 PROMPT BLOCK | Block starts with `WHAT I ALREADY KNOW`, contains the **newest** fact + provenance, ≤1,600 chars; at `cap:240` the newest fact and the honest truncation marker both survive. |
| T6 SCOPES/RECALL | User-scope file in userData; both scopes render; newest ranks first; bounded recall; `forget` removes exactly one. |
| T7 CONFINEMENT | `../` traversal and UNC targets refused; nothing written outside the root. |

**Regression verification (all GREEN, 29/29 total):**
```
node --test --test-force-exit tests/v1131-learning.test.mjs tests/v1123-memory-audit.test.mjs tests/v1135-memory-continuity.test.mjs
# tests 29 / pass 29 / fail 0
```

**Typecheck (final verification, exit 0 for both):**
```
npx tsc --noEmit --strict --target ES2022 --module CommonJS --moduleResolution Node --types node --skipLibCheck electron/services/memoryContinuity.ts   # exit 0
npx tsc -p tsconfig.node.json --noEmit                                                                                                                # exit 0
```
Transient note: during the audit window, concurrent edits by other agents briefly broke `electron/agent/costs.ts` and `electron/agent/providers.ts`; those were resolved by their owners before the final run. None of those errors touched this agent's files.

---

## 5. HANDOFF — exact edits required to make it LIVE / التسليم

I did not edit these files (other agents own them). Apply these four precise changes; each is a few lines and keeps the layer capability-neutral/offline.

### H1 — Injection into the next system prompt (the highest priority)
**File:** `electron/agent/playbook.ts`, inside `renderPlaybookPrompt` (at audit time `:341-398`), immediately after the `mem` block (`:385-392`) and before `return out` (`:397`):
```ts
import { renderContinuityBlock } from '../services/memoryContinuity';
// … after `if (mem) out = `${out}\n\n${mem}`;`
let continuity = '';
try {
  continuity = renderContinuityBlock({ workspace: data.workspace, userDataDir: opts.userDataDir });
} catch { continuity = ''; } // memory must never break the prompt
if (continuity) out = `${out}\n\n${continuity}`;
```
No `engine.ts`/`prompts.ts` edit is needed: `engine.ts:2702/2715` already passes this body as `playbook:` and `prompts.ts:979` injects it into the dynamic tail. Optional: extend the dedup guard at `prompts.ts:100-102` to `/CUMULATIVE SESSION MEMORY|WHAT I ALREADY KNOW/i` via the exported `isContinuityMarker()`.

### H2 — `remember` must write through to the durable layer
**File:** `electron/agent/tools.ts`, `rememberTool` (`:3324`), at the end of both branches — user/feedback (`:3362-3374`) and project/reference (`:3376-3415`), before each `return`:
```ts
import { writeContinuityFact } from '../services/memoryContinuity';
writeContinuityFact({
  workspace: ctx.workspace,
  scope: userStore ? 'user' : 'project',
  ...(userStore ? { userDataDir: <app.getPath('userData')> } : {}),
  text: content,
  kind: kind === 'feedback' ? 'correction' : userStore ? 'preference' : 'decision',
  provenance: 'remember',
  source: 'electron/agent/tools.ts:rememberTool',
});
```
This alone closes the "written but never injected" gap for explicit remembers (together with H1).

### H3 — `recall_memory` must search it
**File:** `electron/agent/tools.ts`, `recallMemoryTool` (`:3451`), after the existing `recallMemory(...)` call:
```ts
import { recallContinuity } from '../services/memoryContinuity';
const durable = recallContinuity({ workspace: ctx.workspace }, query, { limit });
// append `durable` excerpts (text + lastSeen) to the returned hits/lines
```

### H4 — pins survive restart (optional)
**File:** `electron/agent/tools.ts`, `pinContextTool` (`:7561/7578`), after `addPin(...)`: also `writeContinuityFact({... text, kind:'fact', provenance:'pin_context'})`. Keep `contextStore.ts:38-41` as-is (session-local pins are fine once the durable copy exists).

### H5 — make the portable profile carry it (optional)
**File:** `electron/services/profileService.ts:31-40` — add a `continuity` field (user scope) to `SadeemProfile`, export via `readContinuity({scope:'user', userDataDir})`, import via `writeContinuityFact` for each fact. Today `profileService.ts` carries DNA but no memory at all.

---

## 6. Final answer to the founder / الإجابة الأخيرة

- **Does the AI remember across restarts now?** For compaction-derived memory: **yes, and it always did** — proven with real artifacts and 23 pre-existing green assertions. For **your explicit `remember` facts and pins: no**, because they are written to a store that is suppressed or in-memory. This agent built the honest replacement layer and proved it with 7 real tests; **it needs the 4 handoff edits above to be live**.
- **What is bounded?** 512 facts/scope on disk, 1,600 chars in the prompt view, 2,000 chars/fact, 16 recall hits — all explicit, all with an `evicted` counter and an honest truncation marker. Bounded ≠ silent: a new fact always displaces an old reinforced one, and the prompt now tells the model to keep learning.
- **Capability-neutral / offline?** Yes — `node:fs`, `node:path`, `node:crypto` only. No provider, no network, no permission changes, no new tool surface required.
