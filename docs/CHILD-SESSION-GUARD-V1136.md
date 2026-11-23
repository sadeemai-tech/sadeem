#Child Session Guard v11.36 — D3 Verification (POST-FIX)
#فاحص الجلسة الفرعية v11.36 — تحقّق المهمة D3 (بعد الإصلاح)

- Version / الإصدار: **v11.36**
- Date / التاريخ: 2026-11-21
- Scope / النطاق: static-source guard + real SSR/store/engine test + this doc.
- Guard / الفاحص: `node tests-v1136-child-session-guard.mjs`
- Subject / الموضوع: **click an agent card → land inside a REAL child session like OpenCode**
  / **الضغط على بطاقة الوكيل → الدخول إلى جلسة فرعية حقيقية مثل أوبن كود**

---

## 0. Blunt verdict / الحكم الصريح

**EN — PASS. YES, you can finally drill into a real child session.** The same
guard that was red on the pre-D3 tree now reports **0 failed gates**: real
`toolCalls` on the record, real tool-call rows (name / input / status / output)
in the modal, a parent breadcrumb that **navigates** to the main session via
`sessionId`, and an event-driven store accumulator — with a new engine
`toolcall` event as the real source. No fabricated feed.

**AR — PASS. نعم، يمكنك أخيراً التنقّل إلى جلسة فرعية حقيقية.** الفاحص نفسه الذي
كان أحمر قبل D3 صار يُبلغ **صفر فحوص فاشلة**: حقل `toolCalls` حقيقي في السجل،
صفوف استدعاءات أدوات حقيقية (الاسم / المدخل / الحالة / المخرج) في النافذة، خبز
سلف **ينتقل** إلى الجلسة الرئيسية عبر `sessionId`، ومتجر يجمع من أحداث حقيقية
مع حدث محرك جديد `toolcall` كمصدر. لا بثّ مُختلَق.

> Caveat / تحفّظ: inline subagents now stream **full** input/output/status —
> `engine.ts:6354` (running + real args) and `engine.ts:6459` (real redacted
> output + status). Only the DETACHED runner (`subagentRunner.ts:297`, D1) still
> streams just the real name via `step`; its full fields stay absent, never
> invented, until D1 calls `recordSubagentToolCall()`.
> / الوكلاء المضمّنون يبثّون الآن المدخل والمخرج والحالة كاملين
> (`engine.ts:6354` و`engine.ts:6459`). المشغّل المنفصل فقط (`subagentRunner.ts:297`,
> D1) يبثّ الاسم الحقيقي عبر `step`؛ حقلاه الكاملان غائبان لا مُختلَقان إلى أن
> يستدعي `recordSubagentToolCall()`.

---

## 1. Gates → implementation / الفحوصات → التنفيذ

| Gate / الفحص | Result / النتيجة | Evidence / الدليل (file:line) |
|--------------|------------------|-------------------------------|
| `G1-TOOLCALLS-FIELD` | PASS | `shared/types.ts:332` — `toolCalls?: SubagentToolCall[]` |
| `G1-TOOLCALL-SHAPE` | PASS | `shared/types.ts:292` — name/input/output/status/at |
| `G1-PARENT-LINK` | PASS | `shared/types.ts:321` — `sessionId: string` |
| `G2-READ-TOOLCALLS` / `G2-MAPS-TOOLCALLS` | PASS | `SubagentDetailModal.tsx:78, 321` |
| `G2-ROW-NAME/INPUT/STATUS/OUTPUT` | PASS | `SubagentDetailModal.tsx:325-352` — real rows |
| `G2-NOT-GENERIC` / `G2-NO-FABRICATION` | PASS | real rows; empty state when no event |
| `G3-CARD-CLICK` / `G3-CARD-BUTTON` | PASS | `AgentTeamCard.tsx:262` (unchanged) |
| `G3-BREADCRUMB-UI` | PASS | `SubagentDetailModal.tsx:248` — `sad-breadcrumb` |
| `G3-BREADCRUMB-NAV` | PASS | `SubagentDetailModal.tsx:178` — `openSession(record.sessionId)` |
| `G4-I18N / RTL / MOTION / HAIRLINE` | PASS | `agentSession.css:16, 148`; `subagents.css` unchanged |
| `G5-STORE-TOOLCALLS / APPEND / EVENT-DRIVEN` | PASS | `store.ts:77, 2758, 4849` |
| `G5-REAL-SOURCE` | PASS | `subagents.ts:307, 320` — `emit('toolcall', …)` |

**EN:** counter events (`subagent_progress`) are untouched — V1131/V1132
compatibility preserved. **AR:** أحداث العدّادات باقية كما هي — توافق V1131/V1132
محفوظ.

---

## 2. Verification snapshot / لقطة التحقّق

```
node tests-v1136-child-session-guard.mjs                    → PASS, 0 failed
node --test --test-force-exit tests/v1136-child-session.test.mjs → 9/9 pass
node --test --test-force-exit tests/v1135-agent-drill.test.mjs    → 8/8 pass
node --test --test-force-exit tests/v1134-art-guard.test.mjs      → 11/11 pass
npx tsc -p tsconfig.node.json --noEmit                      → clean
```

`npx tsc --noEmit (src)` is clean for every file in this task's ownership;
transient errors were reported in `UsagePanel.tsx` / `FlowsPanel.tsx`, edited
concurrently by other agents.

/ فحص `npx tsc --noEmit` نظيف لملفات هذه المهمة؛ أخطاء عابرة ظهرت في
`UsagePanel.tsx` / `FlowsPanel.tsx` التي يحرّرها وكلاء آخرون بالتوازي.

**Stale guard inverted / فاحص قديم قُلِب:** `tests-v1135-agent-drill-guard.mjs`
used to assert the OLD gap (`SRC-NO-TRANSCRIPT-FIELD`: "no toolCalls field").
That single gate was inverted to `SRC-TRANSCRIPT-FIELD` ("HAS a real toolCalls
array") — the guard now reports **RESULT: PASS, 0 failed**. No other guard
logic was changed.
/ كان يؤكّد الفجوة القديمة (`SRC-NO-TRANSCRIPT-FIELD`)؛ قُلِب هذا الفحص فقط إلى
`SRC-TRANSCRIPT-FIELD` («يوجد حقل toolCalls حقيقي») فصار الفاحص **PASS بصفر
فحوص فاشلة**. لم يُغيّر أي منطق آخر.

---

## 3. Honesty contract / عقد الصدق

- No `FAKE/MOCK/SAMPLE/DEMO` transcript, no invented tool names in source or SSR.
  / لا نص مختلَق ولا أسماء أدوات مُخترَعة في المصدر أو في SSR.
- A tool name is data read from an event (`call.name` / `toolCallsFromStep`),
  never a literal in the component. / اسم الأداة بيانات من حدث لا حرف ثابت في المكوّن.
- Empty feed → zero rows + honest "Waiting for the next step…".
  / بثّ فارغ → صفر صفوف + حالة «بانتظار الخطوة التالية…».

---

## 4. Closing statement / كلمة أخيرة

**EN:** The guard now says PASS — you can click the agent card and land inside
the child session, with the real tool-call transcript and a way back to the
parent. This is a source/SSR gate, not a byte-for-byte OpenCode clone; the only
remaining full-`input`/`output` gap is the detached runner's, a D1 handoff
(inline subagents are already fully wired at `engine.ts:6354`/`:6459`).

**AR:** الفاحص يقول الآن PASS — يمكنك الضغط على بطاقة الوكيل والدخول إلى الجلسة
الفرعية، مع خط زمني حقيقي لاستدعاءات الأدوات وطريق عائد إلى الجلسة الأم. هذا
فاحص مصدر/SSR لا نسخة مطابقة لأوبن كود؛ حقل `input`/`output` الكامل للمشغّل
المنفصل فقط متبقٍ لتسليمه إلى D1 (الوكلاء المضمّنون موصلون بالكامل في
`engine.ts:6354`/`:6459`).
