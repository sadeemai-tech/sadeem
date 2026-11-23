# v11.18 Final Test Status / حالة اختبارات v11.18 النهائية

> **Verdict / الحكم: ❌ NOT GREEN — the full suite has 2 failing tests.**
> **ليست "خضراء" — مجموعة الاختبارات الكاملة فيها اختباران فاشلان.**

- Generated / التاريخ: 2026-11-19 ~14:30 (local)
- Role / الدور: FINAL TEST GUARD (diagnosis-only; no source files were edited by this agent).
- Working tree was stable (no mtime changes) for ~120 s before the run started.
- 7 new `v1118-*.test.mjs` suites were present at run time:
  `v1118-claim-audit`, `v1118-engine-quiet`, `v1118-i18n-clean`,
  `v1118-no-tool-slicing`, `v1118-profiles-honesty`, `v1118-simple-turn-clean`,
  `v1118-vibe-quiet`.

---

## 1. Full run / التشغيل الكامل

Commands / الأوامر:
```
node D:\ORION\data\cache\tmp\opencode\rebuild-bundles.cjs   # exit 0, 8 bundles rebuilt
npm test                                                    # exit 1
```

Exact TAP totals / الأرقام الدقيقة من TAP:

| Metric | Value |
|---|---|
| tests | **729** |
| pass | **711** |
| fail | **2** |
| cancelled | 0 |
| skipped | **16** |
| todo | 0 |
| suites | 0 |
| duration_ms | 596616.6014 (~9 min 57 s) |
| process exit code | **1** |

Log / السجل: `D:\ORION\data\cache\tmp\opencode\v1118-npm-test.log`

---

## 2. Every `not ok` line (with file:line) / كل أسطر `not ok` مع الملف والسطر

1. `not ok 115 - e: zero-byte stream beyond the idle window → watchdog fires and the retry succeeds`
   - location: `tests/v1110-endurance.test.mjs:466:1`
   - assertion stack: `tests/v1110-endurance.test.mjs:481:12`
   - error: `retry fired by the WATCHDOG (600ms window), not the 2.5s socket cleanup`
   - nature: timing assertion `mock.requests[1].at - mock.requests[0].at < 1900` under a 600 ms idle window.

2. `not ok 144 - A7 mcp: full engine run — model calls the discovered MCP tool`
   - location: `tests/v1110-subsystems.test.mjs:356:1`
   - assertion stack: `tests/v1110-subsystems.test.mjs:365:10`
   - error: `MCP tool result reached the engine`
   - nature: `assert.ok(res?.ok && res.output.includes('echo:ping-from-model'))`; the `tool_start` event was seen but the tool result did not reach the engine.

Both failures are in **pre-existing v1110 suites**, not in any new v1118 suite.
كلا الفشلين في مجموعات `v1110` القديمة، وليس في أي مجموعة `v1118` جديدة.

---

## 3. Isolation reruns / إعادة التشغيل المنفردة (flaky vs real)

Each failing test was re-run in isolation multiple times to distinguish a flake from a real regression.
أُعيد تشغيل كل اختبار فاشل عدة مرات بشكل منفرد للتمييز بين التذبذب (flaky) والعطب الحقيقي.

| Test | Full run | Iso #1 | Iso #2 | Iso #3 | Iso #4 | Verdict |
|---|---|---|---|---|---|---|
| watchdog (`v1110-endurance.test.mjs:466`) | FAIL | FAIL | PASS | PASS | PASS | **FLAKY** — timing-sensitive, 2 fails / 5 attempts |
| mcp full engine run (`v1110-subsystems.test.mjs:356`) | FAIL | FAIL | PASS | FAIL | FAIL | **FLAKY but frequent** — 4 fails / 5 attempts |

Method / الطريقة:
- watchdog: `node --test --test-force-exit --test-name-pattern='zero-byte stream beyond the idle' tests/v1110-endurance.test.mjs`
- mcp: the name contains mojibake chars (`€”` for an em-dash), so a name-pattern matched 0 tests; the **whole file** was run instead:
  `node --test --test-force-exit tests/v1110-subsystems.test.mjs`
- Logs: `v1118-rerun-watchdog-{1..4}.log`, `v1118-rerun-mcp-full{1..4}.log`.

Note: the first two mcp "passes" from the name-pattern attempt were **invalid** (`1..0` — zero tests ran); they are excluded from the table above.
ملاحظة: نجاحا الـ mcp عبر الـ name-pattern كانا باطلين (لم يُشغّل أي اختبار `1..0`) وتم استبعادهما.

### Pre-existing evidence / دليل على أن الفشل قديم

The very same failures appear in logs recorded **before** the v1118 edits (which began ~14:09):
نفس الفشلين ظهرا في سجلات أقدم من تعديلات v1118:

- `sadeem-v1117.log` (13:43 today): `not ok 144 - A7 mcp: full engine run — model calls the discovered MCP tool`
- `sadeem-v1116-final.log`: `not ok 144 - A7 mcp: ...`
- `npm-test-final.log` (2026-11-18): `not ok 115 - e: zero-byte stream beyond the idle window ...`

→ **Neither failure was introduced by the v1118 change set.** They are long-standing intermittent tests.
→ **لا يعود أيٌّ من الفشلين إلى تعديلات v1118؛ كلاهما اختباران متذبذبان قديمان.**

### New v1118 suites / مجموعات v1118 الجديدة

All subtests of all 7 new v1118 suites **passed** in the full run (TAP items 588–624: claim-audit 588–591, engine-quiet 592–593, i18n-clean 594–599, no-tool-slicing 600–605, profiles-honesty 606–609, simple-turn-clean 610–614, vibe-quiet 615–624). No `not ok` belongs to v1118.
نجحت جميع اختبارات المجموعات السبع الجديدة؛ لا يوجد أي `not ok` يعود إلى v1118.

---

## 4. TypeScript / فحص الأنواع

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json        # exit 0, 0 errors
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json   # exit 0, 0 errors
```
No `error TS` lines in either config. Logs: `v1118-tsc-app.log`, `v1118-tsc-node.log` (both empty).
لا توجد أخطاء أنواع في أي من الإعدادين.

---

## 5. Tool inventory / جرد الأدوات

```
node scripts/gen-tool-inventory.mjs
gen-tool-inventory: 145 tools written ({"fs":55,"exec":60,"meta":30})
```
`src/generated/toolInventory.json`: `total = 145`, `tools.length = 145`.
**Required count 145 — PASS, no reduction.** / العدد المطلوب 145 — نجح، دون نقصان.

---

## 6. Final verdict / الحكم النهائي

**❌ The full suite is NOT green: 729 tests, 711 pass, 2 fail, 16 skipped, exit code 1.**
**❌ المجموعة الكاملة ليست خضراء: 729 اختبارًا، 711 ناجحًا، 2 فاشلان، 16 متخطى، رمز الخروج 1.**

Honest summary / الخلاصة بصراحة:

- The run is **red/amber**, not green — do not report "all tests pass".
- التشغيل **أحمر/برتقالي** وليس أخضرًا — لا تقل "كل الاختبارات نجحت".
- The 2 failures are **known pre-existing flaky tests** (timing-sensitive watchdog; intermittent MCP tool-result delivery). They failed in earlier v1116/v1117 runs too, and each passed at least once in isolation here. They are intermittent, not deterministic.
- الفشلان اختباران **متذبذبان قديمتان** فشلا في تشغيلات v1116/v1117 السابقة أيضًا، ونجح كل منهما مرة على الأقل عند التشغيل المنفرد؛ هما متقطعان وليسا عطبًا حتميًا.
- **No v1118 test failed.** All 7 new v1118 suites passed in the full run.
- **لا يوجد أي اختبار v1118 فاشل**؛ نجحت المجموعات السبع الجديدة كاملًا.
- TypeScript: clean (0 errors in both configs). Inventory: 145 intact.
- أنواع: نظيفة (صفر أخطاء)؛ الجرد: 145 سليمة.
- Recommended follow-up (not done here, diagnosis-only): stabilize the two v1110 flaky tests (raise/instrument the `1900 ms` watchdog assertion; make the MCP tool-result delivery deterministic/awaited) — but these are unrelated to v1118 and existed before it.
- المتابعة المقترحة (لم تُنفّذ هنا): تثبيت الاختبارين المتذبذبين، لكنهما لا علاقة لهما بـ v1118.
