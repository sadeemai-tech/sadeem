# STALE TEST GUARD — v11.24 (STALE-TESTS-V1124.md)

**EN:** Diagnosis-only report. **No test file was edited by this agent.** The parent applies the fixes.
**AR:** تقرير تشخيص فقط. **لم يتم تعديل أي ملف اختبار بواسطة هذا الوكيل.** الوكيل الأصلِي يطبّق الإصلاحات.

Scope scanned: every `tests/*.test.mjs` (the files `npm test` actually runs:
`node --test --test-force-exit --test-concurrency=4 tests/*.test.mjs`), plus a cross-check on
`tests/*.mjs` bundles (bundles are NOT run by `npm test` — excluded from the ranking).

---

## 0. Target state / الحالة المستهدفة (what A1–A5 are doing)

| # | Agent change (from parent brief) | Symbol(s) in tests |
|---|---|---|
| 1 | REMOVE big standalone live circle | `LiveThinkingPanel`, `cp-live-glyph`, `cp-live-panel`, the 64-grid / 80px glyph |
| 2 | REMOVE ring + wave decor | `cp-live-dots`, `cp-live-sweep`, `sc-shimmer` (sweep keyframes) |
| 3 | REMOVE trembling gerund | `rotateGerund`, `GERUND_ROTATE_MS`, gerund crossfade |
| 4 | REMOVE duplicate THINK circle | the 2nd copy (`PHASE_MARKS.think` / square wrapper). Per `v1124-think-circle.test.mjs`, the single `ThinkOrbit` at `sc18-node-ico` STAYS. `PrecisionThinkingOrbit` is CONDITIONAL — see **P2**. |
| 5 | REMOVE framed focus mode | frame/max-width/measure rules in `shell.css` (already landed — see "Non-stale") |
| 6 | MOVE a small circle into the timeline strip | `CompactThinkingOrbit` / `sc-think-orbit` — assertions pinning it to `MessageView.tsx` become stale when it moves to `StreamTimeline.tsx` |

**Live observation / ملاحظة مباشرة:** while I scanned, source was being edited:
`ChatPanel.tsx` (11:58), `StreamTimeline.tsx` (11:56), `shell.css` (11:55) already changed;
`MessageView.tsx` and `src/lib/streamDisplay.ts` had NOT changed yet. So this is a *moving target* —
rank reflects the **intended final state**, not a single snapshot.

---

## 1. RANKED STALE ASSERTIONS / القائمة المرتّبة حسب احتمال الفشل

Rank key: **P0** = already failing / certain to fail; **P1** = will fail when that agent lands;
**P2** = conditional (depends on which variant is removed); **SAFE** = will still pass (do not edit).

### P0 — ALREADY STALE (source already changed)

**P0-1 — `tests/v1111-stream-ui.test.mjs:204`**
```js
assert.ok(chatPanel.includes('rotateGerund(phase,'), 'gerund picked by live phase (rotating)');
```
`ChatPanel.tsx:530` now calls `pickGerund(phase)` with **no timer**; the rotator is gone.
Replace:
```js
assert.ok(chatPanel.includes('pickGerund(phase)'), 'ONE stable gerund, no rotating timer');
```

**P0-2 — `tests/v1122-graphics-panel.test.mjs:209-219`** (hooks-survival loop; stale members):
```js
'cp-live-count', 'cp-live-sweep', 'cp-live-dots', 'sc-status-label',
...
'chat.gerund.', 'chat.run.elapsed', 'formatElapsedClock(elapsed)', 'rotateGerund(phase,',
```
`cp-live-sweep`, `cp-live-dots` and `rotateGerund(phase,` are no longer in `ChatPanel.tsx`.
Remove those three tokens from the array; optionally add an absence guard:
```js
for (const gone of ['cp-live-sweep', 'cp-live-dots', 'rotateGerund(phase,'])
  assert.ok(!chatSrc.includes(gone), `ring/wave/rotator removed: ${gone}`);
```

**P0-3 — `tests/v1111-stream-ui.test.mjs:211-212`** (at risk; CSS not yet cleaned):
```js
assert.ok(chatCss.includes('@keyframes sc-shimmer'), 'shimmer sweep keyframes');
assert.ok(chatCss.includes('sc-shimmer 4s var(--ease-out) 600ms infinite'), '600ms delay, 1s sweep every 4s');
```
TSX rotator is gone; `chat.css:755/832` still carries `sc-shimmer`. If A2/A3 also strip the CSS,
these fail. Replace with absence guards or delete.

**P0-4 — `tests/v1111-stream-ui.test.mjs:70-80`** (unit tests of the removed lib function):
```js
assert.equal(sd.rotateGerund('think', 0), 'thinking');
... assert.equal(sd.GERUND_ROTATE_MS, 8000);
```
`src/lib/streamDisplay.ts` was still unmodified at first scan (mtime 11/18), but **during the full
suite run A3 deleted the export** — the run captured `TypeError: sd.rotateGerund is not a function`
at `v1111-stream-ui.test.mjs:70` (see §4a). These are now confirmed failures. Replace with
`pickGerund` tests or delete the rotation block (lines 69-80).

---

### P1 — FAIL when the big circle / `cp-live-glyph` is removed (A1)

Every one of these asserts `LiveThinkingPanel` or `cp-live-glyph` EXISTS. All will fail.

| File:line | Exact stale assertion | Suggested replacement |
|---|---|---|
| `v1111-stream-ui.test.mjs:197` | `assert.ok(chatPanel.includes('cp-live-glyph'), 'the single primary spinning circle exists');` | `assert.ok(!chatPanel.includes('cp-live-glyph'), 'standalone circle removed');` |
| `v1114-chat-runtime.test.mjs:81` | `'function LiveThinkingPanel', // v11.23 — the ONE primary circle (ChatLiveIndicator removed)` (inside `for (const helper of [...])`) | drop the entry; add `assert.ok(!chatSrc.includes('function LiveThinkingPanel'), 'big panel deleted')` |
| `v1114-chat-runtime.test.mjs:93` | `assert.ok(chatSrc.includes('className="cp-live-glyph shrink-0"'), 'the single primary circle survives');` | flip to `assert.ok(!chatSrc.includes('cp-live-glyph'), 'no standalone glyph')` |
| `v1121-circle.test.mjs:88-97` | `test('exactly ONE primary LiveThinkingPanel mount …')` — `assert.equal(count(chatSrc, '<LiveThinkingPanel'), 1, ...)`, `count(chatSrc,'cp-live-panel sticky')===1`, `chatSrc.includes('{livePanelVisible && <LiveThinkingPanel done={!running} />}')` | delete the test or convert to "ZERO mounts" (`=== 0`) |
| `v1121-circle.test.mjs:117-129` | `test('top panel circle is pixel-precise …')` — `chatSrc.includes('r="26"')`, `'values="26;28;26"'`, `'d="M32 1v2"'`, `'strokeDasharray="9 100"'`, etc. | delete — the glyph no longer exists in `ChatPanel` |
| `v1121-circle.test.mjs:154` | `assert.ok(chatSrc.includes('cp-live-panel') && chatSrc.includes('cp-live-glyph'), 'live panel hooks intact');` | assert the new timeline hook instead (or absence of both) |
| `v1121-circle.test.mjs:183-189` | `test('running ChatPanel renders exactly ONE primary live panel')` — `count(html,'cp-live-panel')===1`, `count(html,'cp-live-glyph')===1`, `html.includes('role="status"')` | target the new single circle in the timeline strip; `role="status"` now lives on `.sc-status-label` (`ChatPanel.tsx:541`) |
| `v1121-circle.test.mjs:191-195` | `test('idle ChatPanel renders no primary live panel')` — `count(html,'cp-live-panel')===0` | **SAFE** (already asserts zero) — keep, just rename |
| `v1122-graphics-panel.test.mjs:95-107` | `test('exactly one primary LiveThinkingPanel mount …')`: `count(chatSrc,'<LiveThinkingPanel')===1`, `count(chatSrc,'function LiveThinkingPanel')===1`, `count(chatSrc,'cp-live-panel sticky')===1`, guarded-mount + placement assertions | delete / convert to zero-mount guards |
| `v1122-graphics-panel.test.mjs:112-119` | `test('primary circle renders at 80px …')`: `between(chatSrc,'className="cp-live-glyph','</svg>')`, `/width="80"\s+height="80"/`, `style={{ width: 80, height: 80 }}` | delete — `between()` asserts its start marker → test fails at extraction |
| `v1122-graphics-panel.test.mjs:121-140`, `142-171`, `173-181`, `225-234` | four more tests that all call `between(chatSrc, 'className="cp-live-glyph', '</svg>')` | delete or retarget to the new circle's SVG block |
| `v1122-graphics-panel.test.mjs:186-198` | `test('no duplicate working circle …')` ends with `between(chatSrc,'className="cp-live-glyph shrink-0"','/>')` + glyph assertions | keep the negative lines (188-192); delete lines 193-197 |
| `v1122-graphics-panel.test.mjs:272`, `:307`, `:315` | `assert.equal(count(html, 'cp-live-glyph'), 1, 'one big circle in the DOM')` / `…, 0, 'no big circle while idle'` / `…, 1, 'circle still present'` | change the expected counts to `0` (or point at the new hook) |
| `v1122-full-smoke.test.mjs:403`, `:748` | `liveGlyph80: /cp-live-glyph[\s\S]{0,600}?width="80"/.test(h)` ; `assert.ok(m.liveGlyph80, 'ChatPanel(running) must render cp-live-glyph at width="80" …')` | set expectation to `false`/remove; assert the timeline circle marker instead |
| `v1122-full-smoke.test.mjs:762-766` | `const start = cpSrc.indexOf('function LiveThinkingPanel'); … assert.ok(start >= 0 && end > start, 'LiveThinkingPanel region must be present');` | delete / flip to `assert.ok(start < 0, 'big panel removed')` |
| `v1123-circle-dedupe.test.mjs:79-88` | `test('source: exactly one primary LiveThinkingPanel mount …')`: `count(code,'<LiveThinkingPanel')===1`, `count(code,'function LiveThinkingPanel')===1`, `code.includes('cp-live-glyph')`, `viewBox="0 0 64 64"`, `width="80"` | delete / convert to zero + absence of glyph |
| `v1123-circle-dedupe.test.mjs:90-103` | `test('source: bilingual strings and chat-LEFT / rail-TOP layout anchors intact')` — `code.includes("en: { preparing: 'Preparing…', … }")`, `chat.livePanel.${status}`, etc. (confirmed failing at `:92`) | delete / assert the new status-strings hook instead |
| `v1123-circle-dedupe.test.mjs:182`, `:185`, `:198-208` | `assert.equal(count(html,'cp-live-glyph'),1,'one primary circle in the DOM')`; `html.includes('width="80"')`; `en.includes('Live run status')` / `'Preparing…'` (`:201-202`); `assert.equal(count(ar,'cp-live-glyph'),1,…)` | change to `0` / remove / retarget bilingual strings |
| `v1123-full-smoke.test.mjs:420`, `:812-832` | `primaryGlyph: (h.match(/cp-live-glyph/g)\|\|[]).length` ; whole `WAVE PRIMARY CIRCLE` test: `count(c,'function LiveThinkingPanel')===1`, `count(c,'<LiveThinkingPanel')===1`, `count(c,'cp-live-glyph')===1`, `mounts===1`, `m.primaryGlyph===1`, `m.liveGlyph80` | invert to zero-counts; keep the `chatLiveRing===0` / `chatLiveDot===0` lines (they stay valid) |
| `v1122-graphics-guard.test.mjs:113-126` (**FATAL — module load**) | top-level `ORBS` object calls `svgBlock(CODE.chat,'cp-live-glyph')`; `svgBlock` (`:68-72`) does `assert.ok(b, 'SVG block carrying … exists')` — throws at import if the glyph is gone → **whole file fails to load** | move ORBS construction inside tests, or drop the `'primary live panel'` entry |
| `v1122-graphics-guard.test.mjs:164-182`, `:187-192`, `:209-239`, `:230-239` | loop over `ORBS` (geometry + FX tests), `3a primary live orb ≥72px`, `4a expected LiveThinkingPanel:1`, `4b owners LiveThinkingPanel: 'src/components/ChatPanel.tsx'` | remove the primary-orb entry; change expected mount to `0` |
| `v1123-graphics-guard.test.mjs:272-282` | `test('2b · exactly ONE primary live circle (LiveThinkingPanel)')`: `count(c,'<LiveThinkingPanel')===1`, `count(c,'function LiveThinkingPanel')===1`, `count(c,'cp-live-glyph')===1`, `mounts===1` | delete / flip to zero |
| `v1123-graphics-guard.test.mjs:285-307` | `test('2c · SSR running: one big circle …')`: `count(html,'cp-live-panel')===1`, `count(html,'cp-live-glyph')===1` | flip to zero; keep `chat-live-ring/dot === 0` guards |

---

### P1 — FAIL when the small circle moves to the timeline strip (A6 / move)

These pin `CompactThinkingOrbit` / `sc-think-orbit` to `MessageView.tsx`.

| File:line | Exact stale assertion | Suggested replacement |
|---|---|---|
| `v1121-circle.test.mjs:100` | `assert.ok(msgSrc.includes('function CompactThinkingOrbit'), 'compact circle component defined');` | look in `streamSrc` / new owner instead |
| `v1121-circle.test.mjs:101-104` | `msgSrc.includes('<CompactThinkingOrbit streaming={!!msg.streaming} />'), 'assistant row mounts the compact circle'` | retarget to the timeline-strip mount |
| `v1121-circle.test.mjs:111` | `assert.equal(count(msgSrc, '<CompactThinkingOrbit'), 1, 'compact circle rendered once in source');` | change haystack to the new owner, expect `0` in `MessageView` |
| `v1121-circle.test.mjs:99` (test title) | `'assistant row uses the compact circle; the "نازل من الخط" crosshair is removed'` | rename: circle now lives in the timeline strip |
| `v1121-circle.test.mjs:197-214` | `test('assistant row carries the compact circle …')`: `count(html,'class="sc-plate sc-think-orbit"')===1`, `html.includes('sc-think-orbit-svg')` | assert absence on the assistant row; assert presence on the timeline SSR |
| `v1122-graphics-msg.test.mjs:88-90` (**FATAL — module load**) | top-level `const compactSrc = between('function CompactThinkingOrbit', '/**\n * v11.22 — THE FOUNDER\'S BIG SPINNING CIRCLE');` — `between()` (`:80-86`) asserts the marker → import throws | move extraction into the test or retarget marker to the new file |
| `v1122-graphics-msg.test.mjs:134-150` | `test('compact row orbit enlarged …')`: `count(msgSrc,'<CompactThinkingOrbit')===1`, mount-on-row string, `viewBox="0 0 24 24"`, `width="40"/height="40"`, `r="9"/r="5"`, `r="11"` | retarget to new owner or delete |
| `v1122-graphics-msg.test.mjs:212-222` | `test('SSR: exactly one compact orbit per assistant row …')`: `count(html,'class="sc-plate sc-think-orbit"')===1`, `count(html,'sc-think-orbit-svg')===1` | flip to zero on the row; assert on the strip |
| `v1122-graphics-guard.test.mjs:118-120` (**FATAL**) | `ORBS['compact row orbit'] = { block: svgBlock(CODE.msg, 'sc-think-orbit-svg'), css: … }` at top level | move inside test / retarget |
| `v1122-graphics-guard.test.mjs:212`, `:233` | `CompactThinkingOrbit: 1` and `owners: CompactThinkingOrbit: 'src/components/MessageView.tsx'` | change count to `0` in MessageView and owner to `StreamTimeline.tsx` |
| `v1122-graphics-guard.test.mjs:194-199`, `:312-325` | `3b compact row orbit ≥24px`; `3a … one mount in MessageView source`; `count(html,'class="sc-plate sc-think-orbit"')===1`, `sc-think-orbit-svg===1` | retarget / flip |
| `v1123-graphics-guard.test.mjs:312-326` | `test('3a · exactly one compact orbit per assistant row')`: `count(CODE.msg,'<CompactThinkingOrbit')===1`, mount string, DOM counts `===1` | retarget / flip |
| `v1122-full-smoke.test.mjs:402`, `:754` | `compactOrbit: /sc-think-orbit/.test(h)`; `assert.ok(m.compactOrbit, 'assistant row must render sc-think-orbit …')` | assert against the timeline strip markup |
| `v1123-full-smoke.test.mjs:412`, `:896` | `compactOrbit: /sc-think-orbit/.test(h)`; `compact_orbit_mounts_all_tsx: ALL_TSX.reduce((n,f)=>n+count(f.code,'<CompactThinkingOrbit'),0)` | still valid if moved within ALL_TSX; update the per-file expectation only |

**Note on pixel sizes / أحجام البكسل:**
- `v1122-graphics-msg.test.mjs:113` — `newCircleSrc.includes('width="30"') && … 'height="30"'` (**PrecisionThinkingOrbit 30px**)
- `v1122-graphics-msg.test.mjs:139` — `compactSrc.includes('width="40"') && … 'height="40"'` (**CompactThinkingOrbit 40px**)
- `v1121-circle.test.mjs:134-135` — `msgSrc.includes('width="40"') && msgSrc.includes('height="40"')`
These break when their components move/change; update to the new geometry or remove.

---

### P2 — CONDITIONAL: `PrecisionThinkingOrbit` / duplicate THINK circle

`v1124-think-circle.test.mjs` says the removed duplicate is `PHASE_MARKS.think` (the circle inside
the square), **not** `ThinkOrbit`. If `PrecisionThinkingOrbit` also goes, every assertion below fails;
if only the phase-mark copy goes, they stay green. Do not delete until the source settles.

| File:line | Exact stale assertion | Suggested replacement |
|---|---|---|
| `v1111-stream-ui.test.mjs:227` | `assert.ok(streamTimeline.includes('ThinkOrbit'), 'the spinning circle owns the THINK band');` | **SAFE if single `ThinkOrbit` survives** — keep |
| `v1111-toolvisuals.test.mjs:321` | `assert.ok(streamTimeline.includes('ThinkOrbit'), 'the spinning circle owns the THINK band');` | same as above |
| `v1111-stream-ui.test.mjs:235` | `assert.ok(messageView.includes('PrecisionThinkingOrbit'), 'the precise spinning circle owns the thinking head');` | point at the new single-circle hook, or flip if removed |
| `v1116-chat-precision.test.mjs:123-135`, `:163` | `messageViewSrc.includes('function PrecisionThinkingOrbit')`, `viewBox="0 0 32 32"`, `r="14"/"10"/"6"`, `d="M16 8v4"`, `strokeDasharray="6 100"`, `from="0 16 16"`, `viewBox="0 0 32 32"` | retarget/delete if component removed |
| `v1122-graphics-msg.test.mjs:88` (**FATAL** if removed) | top-level `between('function PrecisionThinkingOrbit', '// memo — a settled reasoning block')` | guard extraction |
| `v1122-graphics-msg.test.mjs:105`, `:110-132`, `:172-203`, `:225-231` | head-mount + geometry + SSR `sc-reason-orbit-svg` assertions | retarget to the surviving circle |
| `v1122-graphics-guard.test.mjs:122-125` (**FATAL**), `:137`, `:201-204`, `:213`, `:234` | `ORBS['precision thinking orbit']` top-level; `<PrecisionThinkingOrbit` in head; `3c ≥24px`; mount counts/owners | guard / update |
| `v1122-full-smoke.test.mjs:401`, `:752` | `reasonOrbit: … sc-reason-orbit-svg`; `assert.ok(m.reasonOrbit, 'thinking head must render sc-reason-orbit-svg … (PrecisionThinkingOrbit)')` | retarget |
| `v1123-full-smoke.test.mjs:411` | `reasonOrbit: … sc-reason-orbit-svg` (+ its `assert.ok`) | retarget |
| `v1123-full-smoke.test.mjs:796-801` | `WAVE THINK: SSR THINK band … m.thinkOrbit`, `m.thinkSpin` | **SAFE** if single `ThinkOrbit` survives |

---

### SAFE — do NOT edit / لا تلمس (negative guards already assert the old elements are GONE)

These pass before and after A1–A5. They are the v11.21–v11.23 "dedupe" guards; they are the
opposite of stale. Editing them would *weaken* the suite.

- `v1111-stream-ui.test.mjs:198-199` — `!ChatLiveIndicator`, `!chat-live-ring`
- `v1111-stream-ui.test.mjs:200`, `:225`, `:226`, `:233-234`, `:238` — no Logo / ThinkBrand / Brain
- `v1111-toolvisuals.test.mjs:319` — `!streamTimeline.includes('brand: true')`
- `v1114-chat-runtime.test.mjs:91-92` — `!function ChatLiveIndicator`, `!className="chat-live"`
- `v1122-graphics-panel.test.mjs:188-192`, `:274-276`, `:297` — zero `chat-live-ring` / `sc-status-glyph` / `sc-status-orbit`
- `v1123-circle-dedupe.test.mjs:50-74` — all `ChatLiveIndicator` / ring hooks `=== 0`
- `v1123-full-smoke.test.mjs:787-794`, `:803-810` — `ThinkBrand`/`brand: true`/`ChatLiveIndicator`/`chat-live-*` `=== 0`
- `v1123-graphics-guard.test.mjs:198-199`, `:264-270`, `:304-306` — `ThinkBrand`/`brand: true` and ring hooks `=== 0`
- `v1123-think-icon.test.mjs:102-106` — no `ThinkBrand` / `brand: true`
- `v1124-focus-mode.test.mjs` (whole file) and `v1124-focus-guard.test.mjs` (whole file) — these are the **NEW** v11.24 specs: they assert focus mode has only `display:none` + `flex:1 1 auto`, no frame/max-width/measure tokens, and `shell.css` already matches (`shell.css:67-72`). Keep them.
- `v1112-ui-fixes.test.mjs:184-191` (BUG3) — asserts the same natural-size focus rules; aligned, keep.

---

## 2. FATAL module-load risks / أخطار فادحة عند تحميل الوحدات

Two files extract source blocks at **module top level** with `assert.ok(marker >= 0)`. If the symbol is
removed, they don't produce a normal `not ok` — they throw during `node --test` import and take down
the **entire file**:

1. `tests/v1122-graphics-msg.test.mjs:88-90` → `between('function PrecisionThinkingOrbit', …)`, `between('function CompactThinkingOrbit', …)`.
2. `tests/v1122-graphics-guard.test.mjs:113-126` → `ORBS` calls `svgBlock(CODE.chat,'cp-live-glyph')`, `svgBlock(CODE.msg,'sc-think-orbit-svg')`, `svgBlock(CODE.msg,'sc-reason-orbit-svg')`; `svgBlock` asserts at `:71`.

Fix these **first** — they mask all other diagnostics in those files.

---

## 3. Suited replacements, grouped / بدائل مجمّعة

| Old contract | New contract to assert instead |
|---|---|
| `LiveThinkingPanel` mounted once in ChatPanel | no `LiveThinkingPanel` / `cp-live-glyph` anywhere; the ONE circle is in the timeline strip |
| `cp-live-glyph` 80px / 64-grid precision | new orbit's own grid/geometry (or absence in ChatPanel) |
| `rotateGerund(phase,` + `sc-shimmer` + `cp-live-dots/sweep` | `pickGerund(phase)`, one static bilingual `.sc-status-label`, no sweep/dots |
| `CompactThinkingOrbit` in `MessageView` | `CompactThinkingOrbit` (or its successor) in `StreamTimeline.tsx`, count `=== 1` there and `=== 0` in `MessageView.tsx` |
| `PrecisionThinkingOrbit` 30px in thinking head | the single `ThinkOrbit` at `sc18-node-ico` (size 16) per `v1124-think-circle.test.mjs` |
| framed focus mode | `shell.css` focus rules limited to `display:none` + `flex:1 1 auto !important`, no `--focus-*` |

---

## 4. `npm test` run / تشغيل المجموعة الكاملة

### 4a. Full suite (`node --test --test-force-exit --test-concurrency=4 tests/*.test.mjs`)
**INCOMPLETE / غير مكتمل** — killed at the 600s harness cap (`SIGTERM`, exit 143). Cause:
`v1116-heavy-stress.test.mjs:794` (`V1115-STABILITY`) alone took **631.8s**. 803 tests had run
(798 `ok`, 5 `not ok`) when the run was terminated; later files (notably `v1122-graphics-*` and
`v1123-*` full/guard suites) never executed.

Every `not ok` captured, with the exact `file:line` from node's `location:`/`stack`:

| # | Test | file:line | Error | Classification |
|---|---|---|---|---|
| 1 | `d: slow thinking deltas keep the stream alive — watchdog never fires` | `tests/v1110-endurance.test.mjs:440` | `single request — no watchdog-triggered retry` (`13 !== 1`) | **NOT stale** — load/timing flake under `--test-concurrency=4` |
| 2 | `A7 mcp: full engine run — model calls the discovered MCP tool` | `tests/v1110-subsystems.test.mjs:358` | `MCP tool result reached the engine (settled after 3 attempt(s))` | **NOT stale** — timing/retry flake |
| 3 | `gerund picker maps every working-state phase to a canonical gerund` | `tests/v1111-stream-ui.test.mjs:55`, failing at **`:70`** | `TypeError: sd.rotateGerund is not a function` | **STALE (P0-4)** — lib export removed mid-run |
| 4 | `status line: logo glyph, shimmering gerund, …` | `tests/v1111-stream-ui.test.mjs:188`, failing at **`:204`** | `AssertionError: gerund picked by live phase (rotating)` | **STALE (P0-1)** — exact stale assertion confirmed |
| 5 | `V1115-STABILITY: full v1115 stress suite re-run 3 times` | `tests/v1116-heavy-stress.test.mjs:794` | `v1115 run 1 exited -1` (`-1 !== 0`) | **NOT stale** — subprocess killed by the 600s cap / resource exhaustion |

Net: **2 of the 5 observed failures are the v11.24 stale assertions** (both in
`v1111-stream-ui.test.mjs`), exactly matching P0-1 and P0-4. The other 3 are unrelated flakiness.
The killed run proves the "rerun the full suite" step needs a longer cap than 600s; re-run with
`--test-concurrency=4` and ≥ 1200s once the parent's fixes land.

### 4b. Focused stale-suite run (18 stale-related files, `--test-concurrency=2`)
**COMPLETE**, exit 1: **289 `ok`, 27 `not ok`**. Source snapshot: A1–A3/A5 had landed
(`LiveThinkingPanel`, `cp-live-glyph`, `rotateGerund`, `cp-live-dots/sweep` gone from `ChatPanel.tsx`;
focus frame gone from `shell.css`); `MessageView.tsx` still owned `CompactThinkingOrbit` +
`PrecisionThinkingOrbit`, so the "move" and the THINK-duplicate cleanup had **not** landed yet.

Every `not ok`, with node's `location:` (test declaration) and the failing assertion text:

| # | file:line (test) | Failing assertion / error | Stale? |
|---|---|---|---|
| 1 | `tests/v1111-stream-ui.test.mjs:182` | `'the single primary spinning circle exists'` (was `:197`) | STALE (A1) — parent already edited this file after the run |
| 2 | `tests/v1114-chat-runtime.test.mjs:79` | `'ChatPanel defines function LiveThinkingPanel'` (helper list `:81`) | STALE (A1) |
| 3 | `tests/v1121-circle.test.mjs:88` | `count(chatSrc,'<LiveThinkingPanel') === 1` (`:89`) | STALE (A1) |
| 4 | `tests/v1121-circle.test.mjs:117` | `'top ring r="26" present'` (`:118`) | STALE (A1) |
| 5 | `tests/v1121-circle.test.mjs:149` | `'live panel hooks intact'` (`:154`) | STALE (A1) |
| 6 | `tests/v1121-circle.test.mjs:183` | SSR one primary live panel / `count(html,'cp-live-glyph')===1` | STALE (A1) |
| 7 | `tests/v1122-full-smoke.test.mjs:746` | `'ChatPanel(running) must render cp-live-glyph at width="80" …'` | STALE (A1) |
| 8 | `tests/v1122-full-smoke.test.mjs:757` | `'LiveThinkingPanel region must be present'` (`:766`) | STALE (A1) |
| 9 | `tests/v1122-graphics-guard.test.mjs:1:1` | **FATAL at import**: `AssertionError: SVG block carrying "cp-live-glyph" exists` at `svgBlock :71`, called from top-level `ORBS :117` — whole file down | STALE (A1) — **fix first** |
| 10 | `tests/v1122-graphics-panel.test.mjs:95` | `count(chatSrc,'<LiveThinkingPanel') === 1` (`:96`) | STALE (A1) |
| 11 | `tests/v1122-graphics-panel.test.mjs:112` | `'start marker present: className="cp-live-glyph'` (`between()`) | STALE (A1) |
| 12 | `tests/v1122-graphics-panel.test.mjs:121` | same `between()` marker failure | STALE (A1) |
| 13 | `tests/v1122-graphics-panel.test.mjs:142` | same `between()` marker failure | STALE (A1) |
| 14 | `tests/v1122-graphics-panel.test.mjs:173` | same `between()` marker failure | STALE (A1) |
| 15 | `tests/v1122-graphics-panel.test.mjs:186` | `'start marker present: className="cp-live-glyph shrink-0"'` (`:193`) | STALE (A1) |
| 16 | `tests/v1122-graphics-panel.test.mjs:209` | `'ChatPanel preserves cp-live-panel'` (hooks loop `:210-219`) | STALE (A1) |
| 17 | `tests/v1122-graphics-panel.test.mjs:225` | `between()` marker failure | STALE (A1) |
| 18 | `tests/v1122-graphics-panel.test.mjs:267` | SSR one enlarged primary live panel | STALE (A1) |
| 19 | `tests/v1122-graphics-panel.test.mjs:285` | SSR graduations / arcs / centre dot in live glyph | STALE (A1) |
| 20 | `tests/v1122-graphics-panel.test.mjs:310` | SSR reduced-motion SMIL in live glyph | STALE (A1) |
| 21 | `tests/v1123-circle-dedupe.test.mjs:79` | `count(code,'<LiveThinkingPanel') === 1` (`:80`) | STALE (A1) |
| 22 | `tests/v1123-circle-dedupe.test.mjs:90` | `'English live-status strings intact'` (`:92`) — bilingual labels removed with the panel | STALE (A1) |
| 23 | `tests/v1123-circle-dedupe.test.mjs:178` | SSR `count(html,'cp-live-glyph')===1` (`:182`) | STALE (A1) |
| 24 | `tests/v1123-circle-dedupe.test.mjs:198` | `'English aria-label present'` (`:201`) | STALE (A1) |
| 25 | `tests/v1123-full-smoke.test.mjs:812` | `WAVE PRIMARY CIRCLE` — `count(...'function LiveThinkingPanel')===1` etc. (`:814-828`) | STALE (A1) |
| 26 | `tests/v1123-graphics-guard.test.mjs:272` | `2b · exactly ONE primary live circle` — `count(c,'<LiveThinkingPanel')===1` (`:274`) | STALE (A1) |
| 27 | `tests/v1123-graphics-guard.test.mjs:285` | `2c · SSR running: one big circle` — `count(html,'cp-live-glyph')===1` (`:303`) | STALE (A1) |

**All 27 are stale-v11.24 assertions.** There were **no unrelated flakes** in this focused run.

Files that PASSED in the same snapshot (do not "fix" these):
`v1111-toolvisuals.test.mjs`, `v1112-ui-fixes.test.mjs`, `v1116-chat-precision.test.mjs`,
`v1122-graphics-msg.test.mjs`, `v1123-think-icon.test.mjs`, `v1124-focus-mode.test.mjs`,
`v1124-focus-guard.test.mjs`, `v1124-think-circle.test.mjs`, `v1124-composer-orb.test.mjs`.

**Race note / ملاحظة التزامن:** `tests/v1111-stream-ui.test.mjs` was edited by the parent at
12:15:54 — after the run had loaded it. Its current source already uses `pickGerund(phase)`,
`typeof sd.rotateGerund === 'undefined'`, and `!chatPanel.includes('cp-live-glyph')`. I re-ran that
file alone afterwards: **`# pass 10 / # fail 0`** — failures #1 (and full-suite #3/#4) are confirmed
resolved. `v1114-chat-runtime.test.mjs` was likewise edited at 12:16:06 (fixing failure #2), and the
agents were still adding new `v1124-*.test.mjs` files (full-smoke / timeline-guard / send-flow /
strip-clean / latency) at 12:17. Line numbers in this report are the pre-fix snapshot; re-read before
applying `edit` patches. **Re-run the focused suite once the tree is quiet — failures #1/#2 are already
obsolete, the other 25 are not yet confirmed fixed.**

---

## 5. Honest caveats / تحذيرات صريحة

1. **Be brutally honest / بصراحة:** the v11.21–v11.23 "circle guard" suites are *themselves* the stale
   tests. They were written to pin the "ONE primary circle" design that v11.24 now deletes. There is
   no way to keep both. Almost every `assert.equal(count(...), 1, ...)` in those files must be flipped
   to `0` or retargeted.
2. Many assertions are **duplicate coverage** across 6+ files (`v1121-circle`, `v1122-graphics-panel`,
   `v1122-graphics-guard`, `v1123-circle-dedupe`, `v1123-full-smoke`, `v1123-graphics-guard`). The parent
   should fix all of them, not just the first failure — the suite stops reporting the rest only if a
   fatal load error occurs (see §2).
3. **CSS-vs-TSX split:** at scan time `rotateGerund`/`cp-live-dots`/`cp-live-sweep` were already gone
   from `ChatPanel.tsx` but their CSS remained (`chat.css:755,832`, `console.css:1029-1049`). So
   source-level assertions fail first; CSS-level assertions (`@keyframes sc-shimmer`) fail only if A2/A3
   also clean the stylesheets.
4. **Timing:** `MessageView.tsx` and `streamDisplay.ts` had not been edited yet at scan time. If A1/A6
   later remove `CompactThinkingOrbit` or `rotateGerund` from those files, the P1/P0-4 rows upgrade
   from "will fail" to "already failing".
5. I did **not** run `npm test` against a fully-settled tree. The run below is a snapshot; re-run after
   all five agents and the parent's test fixes land.
