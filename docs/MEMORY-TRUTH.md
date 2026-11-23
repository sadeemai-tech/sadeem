# MEMORY TRUTH — v11.21 / حقيقة الذاكرة

> **Verdict / الحكم:** 🟡 **MOSTLY TRUE, WITH ONE REAL BOUNDARY BUG AND SEVERAL HONEST LIMITS.**
> The founder's claim "الذاكرة... يظل متذكر كل شيء" is **true in the normal operating range**, but it is
> **not literally true at every boundary**. Facts persist across two compactions and a restart, and the
> `CUMULATIVE SESSION MEMORY` marker demonstrably reaches the FINAL system prompt. However, once a fact
> category reaches **1024 facts**, a genuinely new fact is **silently dropped on write**. That is a real bug.
>
> **الحكم:** صحيح في المدى التشغيلي الطبيعي، لكنه **ليس صحيحًا حرفيًا عند كل حد**. الحقائق تصمد عبر ضغطين
> وإعادة تشغيل، ويصل مؤشر `CUMULATIVE SESSION MEMORY` إلى نظام الرسائل النهائي. لكن عند بلوغ فئة ما **1024 حقيقة**،
> تُسقَط حقيقة جديدة صامتةً عند الكتابة — هذا خطأ حقيقي.

- Role / الدور: VERIFICATION ONLY. No application source was edited. Only artifacts written:
  `tests/v1121-memory-truth.test.mjs` and this document. / تحقق فقط؛ لم يُعدَّل أي مصدر تطبيق.
- Evidence / الدليل: real files under a temp workspace, two compactions, a dropped-`require.cache` restart,
  and a built system prompt — not comments, not claims.
- Date / التاريخ: 2026-11-19.

---

## 1. The REAL write path / مسار الكتابة الحقيقي

### EN
1. **Post-run (automatic):** `engine.ts:3701` calls `learnPlaybookFacts()` → `playbook.learnPlaybook()`
   (`engine.ts:6153`) → writes `playbook.json` + `PLAYBOOK.md` (`playbook.ts:483-484`) → then calls
   `memorySnapshot()` (`playbook.ts:540-545`) → writes real files
   `.surnia/memory-snapshot.json` (`memory.ts:571`) and `.surnia/memory-history.json` (`memory.ts:579`).
2. **Compaction:** `engine.ts:4512` calls `buildCompactionMemory()` → `memorySnapshot()`
   (`compaction.ts:222`) → same two disk files; the returned advisory block is appended to
   `messages[0].text` (`engine.ts:4555-4556`) so it also survives inside the conversation itself.
3. **Merge rule:** `mergeFacts()` (`memory.ts:245-285`) merges by normalized text, keeps old facts,
   reinforces repeats (`count++`, `memory.ts:261-267`), and inserts genuinely new facts at the tail.
   The original task is set once and never overwritten (`memory.ts:535`).

### AR
1. **بعد كل تشغيل (تلقائي):** `engine.ts:3701` يستدعي `learnPlaybookFacts()` ← `playbook.learnPlaybook()`
   ← يكتب `playbook.json` و`PLAYBOOK.md` ← ثم `memorySnapshot()` ← يكتب فعليًا
   `memory-snapshot.json` و`memory-history.json`.
2. **عند الضغط:** `engine.ts:4512` يستدعي `buildCompactionMemory()` ← `memorySnapshot()` ← نفس الملفين،
   ويُلحَق المقطع الاستشاري بنص الرسالة الأولى (`engine.ts:4555-4556`).
3. **قاعدة الدمج:** `mergeFacts()` يدمج حسب النص المُطبَّع، يحتفظ بالقديم، ويُقوّي المتكرر (`count++`)،
   والمهمة الأصلية تُحدَّد مرة واحدة ولا تُستبدل (`memory.ts:535`).

---

## 2. The REAL read path into the next prompt / مسار القراءة في الرسالة التالية

### EN
`engine.ts:2252` → `playbook.renderPlaybookPrompt(playbook.loadPlaybook(workspace))` → inside it
`renderMemoryBlock(data.workspace, …, {exclude: injectedTexts})` (`playbook.ts:385-392`) →
`readMemorySnapshot()` (`memory.ts:758`, reads the raw JSON from disk at `memory.ts:220-222`) →
`renderMemorySnapshot()` (`memory.ts:617-741`) → body passed as `playbook:` to `buildSystemPrompt()`
(`engine.ts:2265`) → injected into the dynamic tail at `prompts.ts:892-899`.

### AR
`engine.ts:2252` ← `renderPlaybookPrompt()` ← `renderMemoryBlock()` ← يقرأ الـ JSON من القرص ←
`renderMemorySnapshot()` ← يُمرَّر كـ `playbook:` إلى `buildSystemPrompt()` ← يُحقَن في الذيل الديناميكي
(`prompts.ts:892-899`).

---

## 3. Proof — what was actually executed / ما الذي نُفِّذ فعلًا

### EN
Existing harnesses (all green): `tests/v1115-memory.test.mjs`, `tests/v1116-memory-audit.test.mjs`,
`tests/v1119-memory-carryforward.test.mjs` → **25/25 pass**.

New verification suite `tests/v1121-memory-truth.test.mjs` → **9/9 pass**:

| Test | What it proves with real artifacts |
|---|---|
| T1 WRITE | `memory-snapshot.json` + `memory-history.json` exist with the facts in their raw bytes. |
| T2 COMPACT #1 | Two compactions persisted task + decisions + files + preferences + pending + summary-scraped bullets to disk. |
| T3 COMPACT #2 | Every fact from #1 survives #2; version history = `[1,2,3]`. |
| T4 RESTART | After deleting all four `require.cache` entries, fresh modules re-read **every** fact from disk. |
| T5 READ | All facts appear in the **FINAL** system prompt built by `buildSystemPrompt()`. |
| T6 CACHE SPLIT | The marker is **absent** from the cached prefix and **present** in the dynamic tail. |
| T7 RENDER CAP | 4000-char truncation drops the oldest low-priority step from the **view**; full set stays on disk. |
| T8 STORAGE CAP | **REAL BUG reproduced:** a genuinely new fact is dropped when a category already holds 1024 facts. |
| T9 DEDUP/CAPS | normalize()-dedup, MAX_TASKS=8, priority order, original-task protection, empty-block omission. |

### AR
المجموعات الثلاث الموجودة: **25/25 نجاح**. ومجموعة التحقق الجديدة: **9/9 نجاح** — بما فيها إعادة إنتاج
الخطأ الحقيقي عند حد 1024 (T8)، وإثبات وصول المؤشر إلى الذيل الديناميكي لا إلى بادئة الكاش (T6).

**Commands / الأوامر:**
```
node --test --test-force-exit tests/v1115-memory.test.mjs tests/v1116-memory-audit.test.mjs tests/v1119-memory-carryforward.test.mjs
node --test --test-force-exit tests/v1121-memory-truth.test.mjs
```

---

## 4. What TRULY persists / ما الذي يدوم فعلًا

### EN
- `originalTask` — first real user message, protected from dedup, `exclude`, and truncation
  (`memory.ts:535`, `629-635`, `735-739`).
- Every distinct task in `recentTasks` — newest first, up to 8 (`memory.ts:536-541`, `52`).
- Decisions, files touched, preferences, pending steps — merged cumulatively up to 1024 per category
  (`memory.ts:51`, `549-561`). Disk sidecars (DNA, playbook, journal) are re-read each write
  (`memory.ts:518-520`).
- Version history — last 40 revisions (`memory.ts:39`, `578-579`).
- These facts survive two compactions and a fresh-module restart (T2–T4) and reach the model (T5).

### AR
- المهمة الأصلية — محمية من الإزالة والتكرار والقص.
- كل مهمة مميزة في `recentTasks` — حتى 8.
- القرارات والملفات والتفضيلات والخطوات المعلَّقة — تُدمج تراكميًا حتى 1024 لكل فئة؛ تُقرأ المصادر
  من القرص في كل كتابة.
- سجل الإصدارات — آخر 40 مراجعة.
- كل ما سبق يصمد عبر ضغطين وإعادة تشغيل ويصل إلى النموذج.

---

## 5. What is BOUNDED / TRUNCATED — acceptable by design / المحدود والمقتطع (مقبول تصميميًا)

| What | Limit | Exact location | Classification |
|---|---|---|---|
| Rendered prompt block | 4000 chars, line-boundary, priority-ordered | `memory.ts:56`, `713-740` | ✅ Acceptable — full set stays on disk; honest `… [memory truncated …]` marker. |
| Stored facts per category | 1024 | `memory.ts:51`, `284` | ⚠️ **Real bug at boundary** — see §6. |
| `recentTasks` | 8 | `memory.ts:52`, `205`, `539` | ✅ Acceptable — original task is a separate field. |
| Version history | 40 | `memory.ts:39`, `240`, `579` | ✅ Acceptable — inspectability, not current state. |
| Fact text | 220 chars; task text 1200 | `memory.ts:53-54`, `154`, `185`, `204` | ✅ Acceptable — long bullets are clipped. |
| `sources` labels | 12 | `memory.ts:213`, `566` | ✅ Acceptable — provenance only. |
| "Other tasks" section | 3 | `memory.ts:697` | ✅ Acceptable — lowest-priority tier. |
| Playbook items in prompt | top 4/section, 1900-char guard | `playbook.ts:33`, `362-371` | ✅ Acceptable — memory block appended separately at `playbook.ts:396`. |
| Journal read window | 7 days / 3 files / 512 KB tail | `memory.ts:414`, `425`, `429` | ✅ Acceptable — already-absorbed facts live in the snapshot. |
| DNA patterns | 12 | `memory.ts:371` | ✅ Acceptable. |
| Playbook dedup key | 56-char prefix (`SIM_PREFIX`) | `playbook.ts:37`, `150-152` | ✅ Acceptable — distinct 57th chars collapse; bounded. |
| `exclude` dedup | facts already in playbook are skipped in memory block | `playbook.ts:354`, `388`; `memory.ts:623-641` | ✅ Acceptable — prevents double injection; original task exempt. |

> Note / ملاحظة: the `out.slice(0, 1970)` playbook cut at `playbook.ts:395` is effectively unreachable
> because the 1900-char guard at `playbook.ts:367` already bounds `out` below 2000. No mid-word
> playbook truncation occurs in practice. / قص الـ 1970 لا يكاد يُبلَغ لأن حاجز 1900 يسبقه.

---

## 6. What CAN BE FORGOTTEN / ما الذي يمكن أن يُنسى

### 6.1 REAL BUG — 1024-fact storage boundary / خطأ حقيقي عند حد 1024

`mergeFacts()` appends new facts to the array and **then** slices:
`return { facts: out.slice(0, MAX_STORED_FACTS), … }` — `memory.ts:284`.
Reads also slice to 1024 (`memory.ts:211`). Therefore once a category holds 1024 facts, a genuinely
new 1025th fact is **silently discarded from storage**. It will never render, ever, even with a large
cap. The source comment at `memory.ts:44-49` calls 1024 "effectively lossless" — that is true only
below the boundary. **T8 reproduced this with a real on-disk artifact.**
/ عند امتلاء فئة ما بـ 1024 حقيقة تُسقَط الحقيقة الجديدة صامتةً من التخزين ولا تظهر أبدًا.

- Status: **REAL BUG (bounded but violates the literal "no loss" contract).**
- Fix (not applied — verification-only): slice BEFORE merging, or drop the oldest by `lastSeen`
  while explicitly logging, or raise the cap with an eviction policy. Owner: source agent (A7).

### 6.2 CONDITIONAL — settings and run gates / مشروط بالإعدادات

- The post-run automatic memory refresh is gated by `dnaEnabledSetting()` (`engine.ts:3701`) and by
  `params.task === 'chat' && !result.aborted` (`engine.ts:3701`, `3673`). If DNA is disabled in settings
  or the run is aborted/not a chat, the `learnPlaybook()` → `memorySnapshot()` writer is **skipped**.
  Compaction-time writes are unconditional (`engine.ts:4512`), so memory is not entirely lost — but the
  automatic per-run refresh is. / إذا عُطّل DNA أو أُلغي التشغيل يُتخطَّى تحديث الذاكرة التلقائي.
- The DNA **prompt section** is gated by the same setting (`engine.ts:2241-2247`); DNA preferences still
  reach the model via the memory block if a snapshot exists (`memory.ts:350-379`).

### 6.3 SEMANTIC — first-task wins / دلالي: أول مهمة تفوز

`originalTask` is set once, first-wins (`memory.ts:535`). If the first captured user message is a greeting
or a synthetic marker that escaped `originalTaskText()`'s filter (`compaction.ts:62-63`, `103-116`), that
text is authoritative forever and the real objective is demoted to `recentTasks` (capped at 8).
/ إن كانت أول رسالة مُلتقَطة تحيةً، تصبح هي "المهمة الأصلية" إلى الأبد.

### 6.4 BOUNDED VIEW — low-priority facts may not render this turn / عرض محدود

With the 4000-char cap (`memory.ts:713-740`), tail truncation drops the lowest-priority pending steps
and "other tasks" from the **rendered view** while they remain on disk. If higher-priority facts always
consume the budget, a low-priority fact can be invisible to the model for many turns. This is by design
and is flagged with an honest marker; it is not storage loss. / حقائق ذات أولوية منخفضة قد لا تظهر في
رسالة بعينها لكنها باقية على القرص.

---

## 7. Final-prompt / prompt-cache verification / التحقق من الرسالة النهائية والكاش

- `SYSTEM_CACHE_SPLIT = '\n\n<!--SURNIA:STATIC_END-->\n\n'` — `prompts.ts:83`.
- `buildSystemPrompt()` returns `prefix + SYSTEM_CACHE_SPLIT + tail` — `prompts.ts:933`.
- The playbook body (which carries `CUMULATIVE SESSION MEMORY`) is pushed into `tail` at
  `prompts.ts:892-899`, **after** the split — so the provider's cached static prefix never contains it
  and can never drop it. `playbookCarriesMemory()` (`prompts.ts:100-103`) additionally suppresses a
  duplicate `MEMORY.md` injection. **T5 + T6 prove both facts on a built prompt.**
/ المؤشر موجود في الذيل الديناميكي بعد فاصل الكاش؛ لا يمكن لبادئة الكاش حذفه، ومُنع الحقن المزدوج.

---

## 8. Honest bottom line / الخلاصة بصراحة

- ✅ The memory **does** survive two compactions and a restart, with real files as evidence.
- ✅ The memory **does** reach the final system prompt and **is** safe from the prompt-cache split.
- ✅ The original task is genuinely protected from dedup, exclude, and truncation.
- ⚠️ "Remembers EVERYTHING" is **not literally true**: at 1024 facts/category a new fact is dropped
  (real bug, `memory.ts:284`); the prompt renders at most 4000 chars; recent tasks cap at 8; history
  caps at 40; journals are read from a bounded window; and the automatic writer is settings-gated.
- The founder should read §6.1 as the one item that needs an actual source fix; the rest are honest,
  bounded engineering trade-offs.

> **No source was changed by this verification. All findings are backed by `tests/v1121-memory-truth.test.mjs`.**
