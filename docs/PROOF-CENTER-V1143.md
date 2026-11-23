# PROOF CENTER — v11.43 / v1143
## English + العربية — blunt verdict, file:line, evidence

---

## 0. The blunt verdict / الحكم الصريح

**EN:** **YES — it is a real function now, not decoration.** The Proof Center is a
working, read-only ledger of the *current session's actual evidence*. It reads
real tool results and real gate verdicts, it filters and copies them, and it
admits when there is nothing to show. It does **not** invent a green row, a
path, an exit code, or a screenshot hash. One honest limitation remains: there
is no new persisted proof-event log, because `store.ts` is owned by another
wave — the ledger is derived from the real data that already exists (see §4).

**AR:** **نعم — أصبح وظيفة حقيقية الآن، لا زخرفة.** مركز الإثبات سجل للقراءة
فقط يعرض أدلة الجلسة الحالية فعلياً: نتائج الأدوات وأحكام البوابات الحقيقية.
يُمكَن تصفية السجل ونسخه، ويقول بصراحة عندما لا يوجد شيء لعرضه. لا يخترع
صفاً أخضر ولا مساراً ولا رمز خروج ولا بصمة لقطة شاشة. هناك حد واحد صادق:
لم يُنشأ سجل أحداث جديد محفوظ لأن `store.ts` مملوك لموجة أخرى — السجل مشتق
من البيانات الحقيقية الموجودة فعلاً (§4).

---

## 1. Decision: new panel or enhance an existing tab?
## القرار: لوحة جديدة أم تحسين تبويب موجود؟

**EN:** There was **no existing Proof tab/panel**. What existed was:
- `src/components/ProofRibbon.tsx` — a single ~22px PROOF *button* whose only
  action was copying a gate-count summary; the old popover/ledger CSS in
  `proof.css` was dead (it matched no rendered element).
- `src/i18n.ts:3305-3325` — leftover `proof.center.*` strings (unused).
- `src/components/panels/ArtifactsPanel.tsx:118-137` — a "Proof page" HTML
  export, not a ledger.

`v1131-full-smoke.test.mjs:1026-1051` (V3) **hard-forbids** a popover/ledger in
`ProofRibbon.tsx` (exactly one button, no `pr-pop`, no `pr-check`, no dialog).
So I did **not** revive the popover there. Decision: **create one new rail panel**
(`ProofPanel.tsx`) and keep the ribbon as the chip that opens it.

**AR:** لم يكن هناك تبويب «إثبات» موجود. كان الموجود زر PROOF صغيراً في
`ProofRibbon.tsx` ينسخ ملخصاً فقط، وCSS ميتاً في `proof.css`، ونصوصاً غير
مستخدمة في `i18n.ts`، وتصدير صفحة أدلة في `ArtifactsPanel` — لا سجل أحداث.
اختبار `v1131-full-smoke` (V3) يمنع صراحةً وجود لوحة منبثقة داخل الزر،
لذلك لم أُعد إحياءها. القرار: **لوحة rail جديدة واحدة**، والزر يفتحها.

---

## 2. What the panel actually does / ماذا تفعل اللوحة فعلاً

| # | Function (EN) | الوظيفة (AR) | file:line |
|---|---|---|---|
| 1 | Chronological ledger of the session's real tool events + current-run gates | سجل زمني لأحداث الأدوات الحقيقية + بوابات التشغيل الحالي | `src/components/panels/ProofPanel.tsx:148-262` |
| 2 | Each row: claim, evidence, timestamp, honest status | كل صف: الادعاء، الدليل، الوقت، الحالة الصادقة | `ProofPanel.tsx:404-419` |
| 3 | Filter by status / kind / free text, reverse sort | تصفية بالحالة/Nوع/نص، وعكس الترتيب | `ProofPanel.tsx:344-389` |
| 4 | Copy the filtered ledger via real clipboard + honest toast | نسخ السجل عبر الحافظة الحقيقية + إشعار صادق | `ProofPanel.tsx:315-335` |
| 5 | Honest empty state — "No proof recorded yet — run tests or preview to generate evidence." | حالة فارغة صادقة | `ProofPanel.tsx:397-403` |
| 6 | One additive rail entry; ribbon is a working entry point | مدخل rail واحد؛ والزر يفتح اللوحة فعلاً | `registry.tsx:29,42,71,94,123,151`; `ProofRibbon.tsx:39,72,86` |
| 7 | Styles (1px strokes, RTL-safe, reduced-motion guarded, `--ok/--bad/--warn` only) | تنسيقات بخطوط 1px وRTL وحركة محقَّدة | `src/components/proof.css:609-826` |

---

## 3. What "real" means here / ماذا يعني «حقيقي» هنا

**EN — sources, verbatim from existing code:**
- `store.ts:4327-4353` pushes `tool_call` / `tool_result` rows into
  `session.messages` with real `toolName`, `content`, `resultOk`, `timestamp`,
  `images`. These persist across turns and reloads → the ledger's **session**
  rows.
- `store.ts:2264-2372` (`ingestProofEvent`) folds real engine events into
  `proof.gates` with real `detail`/`tone`/`at`:
  `verify_run` (command + exit code), `red_green`, `fake_tests`,
  `mutation_gate`, `critic_verdict`, `run_receipt`. These reset every turn
  (`store.ts:2607-2625`) → the ledger labels them **"current run"**, never as a
  permanent session record.
- `ProofPanel.tsx:148-262` derives rows from those two sources only.

**Honest status mapping (no fabricated green):**
- `resultOk === true` → `verified`; `false` → `failed`; **no result yet →
  `unverified`** (a tool call is a promise, not proof — `ProofPanel.tsx:225-239`).
- gate `tone ok → verified`, `bad → failed`, `warn → unverified`.
- an engine-marked **inconclusive mutation gate is forced to `unverified`**
  even if the rollup tone is `ok` — `ProofPanel.tsx:245-248`.
- Screenshot evidence is a **local djb2 `fp:` fingerprint**, explicitly *not*
  a cryptographic hash — `ProofPanel.tsx:129-133,208`.

**AR:** الصفوف من `session.messages` (نتائج أدوات حقيقية تبقى عبر الجولات)
ومن `proof.gates` (أحكام بوابات التشغيل الحالي التي تُصفّر كل جولة — ولذلك
تُوسم «التشغيل الحالي»). `resultOk=true` ⇒ مُثبَت، `false` ⇒ فاشل، وغياب
النتيجة ⇒ غير مُثبَت. بوابة `warn` أو طفرة غير حاسمة ⇒ غير مُثبَت أبداً.
بصمة اللقطة `fp:` محلية (djb2) وليست تجزئة تشفيرية.

---

## 4. Limits — stated openly / الحدود — بصراحة

**EN:**
1. `store.ts` is not owned by this wave, so there is no *new* append-only
   proof-event array. Session-wide history comes from the transcript, which
   is real but only stores tool results — not the raw `verify_run` /
   `fake_tests` payloads. Those remain per-turn gates, honestly labelled.
2. The visible rail icon (More flyout) is not added here: `Rail.tsx:92-103`
   and `store.ts:59` are owned by another wave. **Handoff (one-line each):**
   add `'proof'` to `RailView` at `src/store.ts:59`, and a `MORE` item at
   `src/components/Rail.tsx:102` using `RAIL_NO`/`RAIL_TITLE` from the registry
   (no i18n edit needed — `proof.title` already exists at `i18n.ts:2520`).
   **This is not a dead end today:** clicking the PROOF chip on any work turn
   calls `setRail('proof')` (`ProofRibbon.tsx:72,86`), so the panel is reachable
   and functional now.

**AR:**
1. `store.ts` ليس مملوكاً لهذه الموجة، لذلك لم يُنشأ سجل أحداث جديد؛ سجل
   الجلسة مشتق من المحادثة الحقيقية، وبوابات التحقيق المفصّلة تبقى لكل جولة
   وموسومة بذلك بصراحة.
2. أيقونة الـ rail المرئية تحتاج سطرين في ملفين لا أملكهما (`store.ts:59`،
   `Rail.tsx:92-103`) — مُحدَّدان أعلاه للتسليم. لكن اللوحة قابلة للوصول
   الآن من زر PROOF في أي جولة عمل (`ProofRibbon.tsx:72,86`).

---

## 5. Verification (commands actually run) / التحقق

| Command | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean, 0 errors |
| `node --test --test-force-exit tests/v1131-full-smoke.test.mjs` | ✅ **82/82 pass**, 60/60 screens, **716 controls scanned, 0 dead controls**, `WAVE FAILURES: 0`, `ENGINE SHAPES: 6 PASS / 0 FAIL` |
| `node --test --test-force-exit tests/v1143-proof-center.test.mjs` | ✅ **5/5 pass** — real command event → rendered row with `npm test -- --run`, real output, exit code, path, failed/unverified statuses, screenshot `fp:`; empty store → honest empty state with **zero** rows; wiring + control checks |

**Honest note on flake:** one intermediate smoke run reported 3 engine shapes
with `requests=0` (mock-provider/journal race in `v1131-full-smoke`, a known
harness issue — `requests=0` while a `task_report` still arrived). A clean
re-run of the **same unmodified engine** was green (6/6). No engine/store file
was touched by this wave; the proof/UI screens stayed 60/60 green in every run.

---

## 6. Files changed / الملفات المعدَّلة

- `src/components/panels/ProofPanel.tsx` — **new**, real ledger + filters + copy + empty state.
- `src/components/panels/registry.tsx` — one additive rail entry (`proof`), local union widening only.
- `src/components/proof.css` — `.pc-*` styles (§5 of the file).
- `src/components/ProofRibbon.tsx` — same single button; now also opens the Proof Center after its real copy (smoke V3 contract preserved).
- `tests/v1143-proof-center.test.mjs` — **new**, real-event → row + honest empty-state test.
- `docs/PROOF-CENTER-V1143.md` — this report.

**Not touched:** `store.ts`, `engine.ts`, `i18n.ts`, any other panel, any
existing test.

**Final verdict / الحكم النهائي:** **Real function — yes. Decorative — no.**
وظيفة حقيقية — نعم. زخرفة — لا.
