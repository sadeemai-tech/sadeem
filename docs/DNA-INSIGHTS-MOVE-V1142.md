# DNA INSIGHTS MOVE — V1142
# نقل «رؤى الحمض» إلى صفحة الحمض النووي — v11.42

> Implementation record, 2026-11-22. This wave **actually moves** the view.
> In v11.40 the tab was only *renamed* ("autopsy" → "insights") and the rail
> renamed ("Signature" → "Run Intelligence"); the "DNA Insights" view still
> lived outside DNA. That is the founder's confusion. Fixed here.
> سجل تنفيذ: في v11.40 تم **تغيير الاسم فقط**؛ أُعيدت التسمية إلى «رؤى الحمض»
> وتغيّر اسم الشريط إلى «استخبارات التشغيل»، لكن العرض ظل خارج صفحة الحمض.
> هذا بالضبط ما أربك المؤسس. تم الإصلاح فعلياً في هذه الموجة.

---

## 1. القرار / What changed

| Before (v11.40) | After (v11.42) |
|---|---|
| Rail 16 had three tabs: REPLAY / **DNA INSIGHTS** / COMPASS | Rail 16 has **two** tabs: REPLAY / COMPASS — `src/components/SignaturePanel.tsx:33`, `:186-189` |
| The insights view rendered in SignaturePanel (`tab === 'insights'`, old `:333-358`) | It renders inside DnaPanel, right after 02 LEARNED PATTERNS — `src/components/panels/DnaPanel.tsx:670-724`; feedback renumbered to 04 at `:726`, `:730` |
| `FindingRow` lived in SignaturePanel (old `:126-170`) | Ported verbatim to `src/components/panels/DnaPanel.tsx:117-161`, with `WHY_LABEL` at `:91-101` and `insightTime` at `:103-115` |
| Rail title already "Run Intelligence" | Unchanged — `src/components/panels/registry.tsx:88`. **No registry edit**: the title was already correct, and Z6's Wiki-rail lines were left untouched. |

**EN:** DNA Insights is now a collapsible, **read-only** `<details open>` section
on the DNA page. It explains the very patterns the page already shows, using
the same `dna` store — no second load, no IPC, no write affordance. The pure
engine stays in `electron/agent/signatureFeatures.ts` with all three APIs and
its drift guard intact.

**AR:** أصبحت «رؤى الحمض» قسماً قابلاً للطي (**للقراءة فقط**) داخل صفحة الحمض،
مباشرة بعد «الأنماط المتعلَّمة». تشرح الأنماط نفسها التي تعرضها الصفحة، من
مخزن `dna` ذاته — بلا تحميل ثانٍ ولا IPC ولا أي زر تعديل. المحرّك البقي
(`signatureFeatures.ts`) احتفظ بواجهاته الثلاثة وحاجز التحقق من الانحراف.

---

## 2. التنفيذ التفصيلي / Exact implementation map

### 2.1 DnaPanel — the new home / البيت الجديد

| Item | Exact file:line |
|---|---|
| Ported `FindingRow` (confidence line, evidence, why chips, prompt mark) | `src/components/panels/DnaPanel.tsx:117-161` |
| Bilingual `WHY_LABEL` (same labels as the old tab) | `src/components/panels/DnaPanel.tsx:91-101` |
| `insightTime()` relative-time helper | `src/components/panels/DnaPanel.tsx:103-115` |
| Real imports `autopsyDNA` + `promptVisibleIds` + types | `src/components/panels/DnaPanel.tsx:15-20` |
| Reused hairline CSS (`.sg-*` only, no duplicated styles) | `src/components/panels/DnaPanel.tsx:31-33` |
| Read-only derivation from the same store (`useMemo`, no api call) | `src/components/panels/DnaPanel.tsx:353-356` |
| RTL declared on the panel root | `src/components/panels/DnaPanel.tsx:406-409` |
| Section: `<details className="… dna-insights" open>` + `<summary>` | `src/components/panels/DnaPanel.tsx:670-696` |
| Toolbar (facts / sessions / active / prompt slots) | `src/components/panels/DnaPanel.tsx:697-702` |
| Honest empty state (`emptyReason`) | `src/components/panels/DnaPanel.tsx:703-710` |
| Real findings list (`.sg-findings`) | `src/components/panels/DnaPanel.tsx:711-715` |
| Advisory caveat + machine code | `src/components/panels/DnaPanel.tsx:716-722` |
| Disclosure chrome (hairline summary, caret, no marker) | `src/components/signature-art.css:362-385` |
| Reduced-motion kill switches (media + `html.reduce-motion`) | `src/components/signature-art.css:388-392` |

The section uses the existing `.sg-finding*` grammar (1px rules, 2px meter,
tabular numerals, `inset-inline` for RTL at `signature-art.css:222-224`). No
cards, gradients or shadows were added.

### 2.2 SignaturePanel — tab removed / إزالة التبويب

| Item | Exact file:line |
|---|---|
| Header updated to two instruments + move note | `src/components/SignaturePanel.tsx:1-16` |
| `Tab = 'trajectory' \| 'compass'` (no `'insights'`) | `src/components/SignaturePanel.tsx:32-33` |
| Two tabs only (REPLAY, COMPASS) | `src/components/SignaturePanel.tsx:186-189` |
| PageHead copy says two instruments + where insights went | `src/components/SignaturePanel.tsx:196-198` |
| Compass is now section 2 | `src/components/SignaturePanel.tsx:269` |
| Deleted: `FindingRow`, `WHY_LABEL`, `autopsyDNA` import, `dna` selector, `autopsy` memo, insights section | absent from `src/components/SignaturePanel.tsx` (guard at `tests/v1142-dna-insights.test.mjs:270-275`) |

### 2.3 Engine untouched / المحرّك لم يُلمس

`electron/agent/signatureFeatures.ts` was **not edited**.
- `promptVisibleIds()` — `:472-500` (mirrors `dna.ts:623-646`).
- `autopsyDNA()` — `:516-628` (mirrors `dna.ts:53-68` / `:478`).
- `AUTOPSY_PROMPT_RULE` — `:384-389`.
- `SIGNATURE_FEATURES` manifest — `:830-835` still lists `trajectory / autopsy / compass` (engine APIs, not UI homes).
- Drift guard — `tests/v1138-signature.test.mjs:359-368` still green.

### 2.4 i18n keys for the parent / مفاتيح مطلوبة من الأب

I did **not** edit `src/i18n.ts` (owned by another wave). The section is already
bilingual **today** via inline `L(en, ar)` fallbacks. When the parent centralizes
the strings, add these keys (EN / AR values in parentheses):

- `dna.insights.title` — "DNA INSIGHTS" / "رؤى الحمض" (`DnaPanel.tsx:684`)
- `dna.insights.tip` — "Read-only explanation of the same stored DNA, plus prompt visibility." / "تفسير للقراءة فقط لنفس الحمض المخزّن، مع بيان ظهوره في الموجّه." (`:675-678`)
- `dna.insights.promptTip` — "Patterns the real prompt builder will inject into the next run" / "الأنماط التي سيحقنها باني الموجّه في التشغيل التالي" (`:689-692`)
- `dna.insights.inPrompt` — "in prompt" / "في الموجّه" (`:694`, `:700`)
- `dna.insights.empty` — "No learned facts are stored yet…" / "لا توجد حقائق متعلَّمة بعد…" (`:705-708`)
- `dna.insights.caveat` — "Advisory only…" / "توجيهي فقط…" (`:717-720`)

Existing keys reused: `dna.tile.facts`, `dna.tile.sessions` (`DnaPanel.tsx:699`).

---

## 3. اختبارات v1138 — which assertions changed / أي تأكيدات تغيّرت

Only assertions that **expected the insights tab** were touched:

1. `tests/v1138-signature.test.mjs:416` — was
   `assert.ok(html.includes('REPLAY') && html.includes('DNA INSIGHTS') && html.includes('COMPASS'));`
   → now `REPLAY && COMPASS` plus a negative `no insights tab` assertion at `:417-418`.
2. `tests/v1138-signature.test.mjs:435-441` (test "SSR: autopsy and compass tabs render real findings and real tools") —
   the four `renderPanel({ initialTab: 'insights' })` finding assertions
   (`PATTERN_TEXT`, `70%`, `your feedback`, `typescript`) were removed;
   the test is now "SSR: compass tab renders real tools (insights moved to DnaPanel in v11.42)" at `:437-443`.
   Those four assertions live on, rendered from DnaPanel, in
   `tests/v1142-dna-insights.test.mjs:228-248`.

No other v1138 assertion was modified; the three-API manifest assertion
(`tests/v1138-signature.test.mjs:472-474`) intentionally still passes.

---

## 4. التحقق / Verification (all green)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **clean** (0 errors) |
| New move test | `node --test --test-force-exit tests/v1142-dna-insights.test.mjs` | **5/5 pass** — real dna.ts writer + real engine; SSR EN/AR DnaPanel findings; SignaturePanel 2 tabs; source guards |
| Signature regression | `node --test --test-force-exit tests/v1138-signature.test.mjs` | **15/15 pass** |
| Full app smoke | `node --test --test-force-exit tests/v1131-full-smoke.test.mjs` | **82/82 pass** — 60/60 screens RENDERS OK, 717 controls scanned, 0 dead controls, 0 unstable selectors, 0 wave failures |

The new test explicitly proves the section is **read-only**: no `<button>`, no
`onClick/onChange`, no Forget/Remove/Delete/`dnaUpdate`/`dnaClear` inside the
`<details>` block (`tests/v1142-dna-insights.test.mjs:243-248`).

> Transient note: during the first `tsc --noEmit` runs, unrelated files
> (`SkillsPanel.tsx`, then `FlowsPanel.tsx`) had parse errors from a concurrent
> editor. A targeted typecheck of the three owned files was clean throughout,
> and the final full `npx tsc --noEmit` was clean after those edits settled.

---

## 5. الحصيلة / Bottom line

**EN:** The founder will no longer find "DNA Insights" on the Run Intelligence
rail. It is one collapsible, read-only section on the DNA page, directly under
the learned patterns it explains, with the same real evidence and prompt-
visibility proof. Signature keeps only the two genuinely unique instruments.

**AR:** لن يجد المؤسس «رؤى الحمض» في شريط «استخبارات التشغيل» بعد الآن.
أصبحت قسماً واحداً قابلاً للطي للقراءة فقط داخل صفحة الحمض، مباشرة تحت
الأنماط التي تشرحها، بالأدلة الحقيقية وإثبات الظهور في الموجّه نفسه.
ويحتفظ الساينكتشر بالأداتين الفريدتين فقط: إعادة العرض والبوصلة.
