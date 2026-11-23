# APP-MOCK-FIDELITY-V1140 / مطابقة واجهة التطبيق في الصفحة

**Scope:** only `website/app/page.tsx` (DEMO data, `APP_MOCK_MOTION`, app-mock
markup) and `website/app/app-mock.css`. Hero, layout and other pages are owned
by other agents and were not touched.

**النطاق:** ملفان فقط: `website/app/page.tsx` (بيانات DEMO و APP_MOCK_MOTION
و markup الواجهة) و `website/app/app-mock.css`. لم نلمس الـ hero ولا التخطيط
ولا الصفحات الأخرى.

---

## 1. ما طلبه المؤسس / What the founder asked for

| Arabic | English | Implementation |
|---|---|---|
| الأيقونات لا تشبه التي بالتطبيق | Icons must be the real ones | Exact lucide identifiers from `Rail.tsx` + verbatim SVG geometry from `icons.tsx` (no invented shapes) |
| نسخ لصق لكل شيء موجود بالشاشة | Literal copy of the app UI | Same rail groups, More flyout data, chat header cluster, phase strip, tool rows, per-message phase line, composer (`+`, mic, orb, effort, model, Send) |
| عدد تبويبات أيقونات كأنني فاتح فيديو | Too many icon tabs | Only the real PRIMARY rail is visible; the other 11 views stay in a collapsed `More` flyout |
| أنيميشن الماوس عشوائي وغير دقيق | Random/imprecise cursor | ONE keyframe; waypoints measured from the actual DOM elements with dwell + easing; static end state |
| شريط الحرير تحته عشوائي وغير مريح | Random "silk" ribbon | One calibrated origin, symmetric hairline arcs, restrained glow, RTL-neutral, reduced-motion guarded |

---

## 2. خريطة المصدر → النسخ / Source → mock mapping

### 2.1 Rail / الشريط العلوي

| Real app (authoritative) | Mock |
|---|---|
| `src/components/Rail.tsx:11-15` — lucide imports `Workflow, House, Quote, LayoutGrid, MoreHorizontal, Keyboard, CalendarDays, ShieldCheck, FolderOpen, Files, Settings2, UsersRound, BookOpen` (+ `BadgeCheck, Blocks` at `:17`) | `website/app/page.tsx:4-22` — the same identifiers imported from `lucide-react`; `GLYPHS` at `:691` maps each view to that exact icon |
| `Rail.tsx:86-91` — `PRIMARY` = Home `00`, Workspace `01`, Sessions `02`, Git `03` | `page.tsx:146-151` — `DEMO.nav` items `00..03` with `home/workspace/sessions/git` glyphs |
| `Rail.tsx:290-295` — the `Files` lucide button | `page.tsx:152` — `Files` entry (no number, like the real button) |
| `Rail.tsx:297-306` — `MoreHorizontal` trigger labelled `More views` | `page.tsx:922-926` — one calm `More views` trigger |
| `Rail.tsx:94-106` — `MORE`: mcp `04`, usage `05`, dna `06`, flows `07`, skills `08`, artifacts `09`, library `10`, wiki `11`, prompts `13`, subagents `15`, signature `16` | `page.tsx:157-169` — `DEMO.railMore` with the **same names and numbers**, rendered into a collapsed flyout at `:929-936` (never crammed as tabs) |
| `Rail.tsx:413-441` — right utilities Search / Preview / Terminal / Settings (`Settings2`) | `page.tsx:170-175` (`DEMO.utils`) + `:938-944` (markup) |
| `Rail.tsx:320-325` — `LayoutGrid` flyout header, `Keyboard`, `CalendarDays`, `ShieldCheck`, `FolderOpen` utilities | `page.tsx:691-704` — registered as `layout/keyboard/plans/security/folder` glyphs |
| `src/components/icons.tsx:35-118` — in-house `IcWorkspace`, `IcSessions`, `IcGit`, `IcMcp`, `IcUsage`, `IcDna`, `IcSearch`, `IcPreview`, `IcTerminal` | `page.tsx:705-733` — the same path/rect/circle data copied verbatim into `GLYPHS` |
| `src/components/shell.css:30,179,203` — `.app-rail-bar-v13`, `.rail-bar-btn`, `.rail-flyout-v12` | `app/page.tsx:897-934` markup; `app-mock.css:147-148` keeps the flyout collapsed |

Note: `Rail.tsx:105` maps **signature** to `IcDna` as well — the mock keeps that
exact duplication (`DNA_SHAPES` shared at `page.tsx:685`, `dna`/`signature` at
`:718` / `:741`).

### 2.2 Chat header + phase strip + transcript

| Real app | Mock |
|---|---|
| `ChatPanel.tsx:13-38` — lucide imports (`MessageSquare`, `MessageSquarePlus`, `Shrink`, `Download`, `Wrench`, `ShieldCheck`, `MoreHorizontal`, `ChevronDown`, …) | `page.tsx:7-22` imports the same names; `GLYPHS` at `:691` registers `recap/review/compact/newSession/sessionsList` |
| `ChatPanel.tsx:1521-1675` — `chat-head-v13` control cluster (recap · review · skills · compact · new · sessions) | `page.tsx:945-952` — `.appmock-head-tools`, styled at `app-mock.css:151-162` |
| `ChatPanel.tsx:477-526` — `MSG_PHASES = thinking → tools → answering → verified`, `MessagePhaseLine` with `cf-phase-line`, `cf-phase-track`, pips and `is-current` | `page.tsx:1041-1050` — `.appmock-msgphase` with `data-phase="answering"`, three `is-on` steps and one `is-current`; `app-mock.css:75-126` |
| `ChatPanel.tsx:606-676` — `RunStatusLine` / `phase-strip run-strip-v13`: one 16px spinning circle, gerund, clock, THINK·WORK·BUILD·RUN·PROVE dots, tools/tokens, `Esc to interrupt` | `page.tsx:964-986` — `.appmock-strip` with the 16/7/3 orbit, gerund, clock, phase dots, stats, hint |
| `ChatPanel.tsx:430-467` — `deriveRunPhases` from real transcript rows (no timers) | `page.tsx` DEMO phase states `:154-160` (static, deterministic; no timer) |
| `MessageView.tsx:2972-3010` — one hairline tool row: icon, tool name, arg path, `OK` duration stamp | `page.tsx:1009-1035` — two tool rows with `file` glyph + `OK 512ms` / `OK 340ms` stamps; `app-mock.css:37-59, 164-166` |
| `console.css` / `chat-final.css:62-103` — `cf-phase-line` grammar, hairline track | `app-mock.css:75-126` mirrors it with logical insets (RTL-safe) |

### 2.3 Composer / المحرر

| Real app | Mock |
|---|---|
| `Composer.tsx:15-16` — `BookMarked, Check, CornerDownLeft, Mic, Search, X, MessageSquare` + `IcFile, IcSend, IcSpark, IcStop` | `page.tsx:7-22` + `GLYPHS`: `mic` (lucide), `plus/send/spark/file` (verbatim `icons.tsx:131-154,214-218`) |
| `Composer.tsx:2057-2066` — the three loose buttons collapsed behind ONE `AttachMenu` trigger | `page.tsx:1080-1088` — one `.appmock-plus` button (no icon row) |
| `AttachMenu.tsx:17-18, 50-118` — `BookMarked`, `History`, `IcImage`, `IcFile`, `IcPlus` menu | `page.tsx:700-702` registers `presets/rewind/image/file/plus`; the flyout stays collapsed |
| `Composer.tsx:2070` — `<EffortControl />` | `page.tsx:1111-1116` — one `.appmock-effort` spark chip + standard value |
| `EffortControl.tsx:49-90, 213-226` — `cf-effort-rail` / trigger with `IcSpark` + label + value | `app-mock.css:173-179` |
| `Composer.tsx:2111` — `<ContextLens compact />` (the ONLY orb) | `page.tsx:1096-1109` — one `.appmock-orb`, exact-arc donut, 12 o'clock tick, tabular value |
| `ContextLens.tsx:33-42, 205-218, 378-410` — `ORB_SIZE=32`, compact `ORB=22`, `r=(ORB-3.5)/2`, `2πr` arc, `-90°` start, `strokeLinecap="round"` | `page.tsx:1098-1108` — same radius formula, `pathLength=100`, `strokeDasharray="62 100"`, `rotate(-90 12 12)` |
| `context-orb.css:137-152` — `.ctx-orb--compact` | `app-mock.css:28-35` + `home.css:645-649` |
| `Composer.tsx:2154-2167` — `composer-send` with `IcSend size={14}` | `page.tsx:1118-1122` — `.appmock-send` with the verbatim `send` glyph |
| `Composer.tsx:2201-2219` — `QUICK_COMMANDS` mono hints | `page.tsx:205` + `:1076-1078`, styled at `app-mock.css:168-172` |

### 2.4 Pointer / مؤشر الفأرة

| Real app / prior mock | New mock |
|---|---|
| Guessed cqw waypoints (`30cqw,70cqw`, `53cqw,71cqw`, …) in old `APP_MOCK_MOTION` | `useAppMockGeometry` at `page.tsx:773-798` measures `.appmock-input-shell`, `.appmock-plus`, `.appmock-orb`, `.appmock-send`, `.appmock-tool` and publishes `--am-c-*-x/y` |
| Old `appmock-cursor-path` in home.css had 14 drifting cqw keyframes | `page.tsx` — ONE `@keyframes appmock-cursor-path`: input → **+** (22–27%) → **orb** (34–39%) → **Send** (46–51%) → tool row (60–72%) → static fade at 100%. The home.css copy was deleted (X6 C1) |
| Old ripple fired on a guessed beat | `appmock-ripple` / `appmock-ring` at `:319-333` fire at 46–47%, inside the measured Send dwell |
| 3 kill switches | `page.tsx:334-354` — `@media (prefers-reduced-motion:reduce)`, `html.reduce-motion`, `html[data-art='off']` |

### 2.5 The band under the console / شريط الحرير

| Prior | New |
|---|---|
| `InkFlow variant="weave"` (3 hand-written crossing curves + accent trickle, `preserveAspectRatio="none"`) | `AppMockSilk` at `page.tsx:806-846`, mounted at `:1225-1228` |
| Crossing / weaving, visually random | `SILK_FAN` `:806-811`: 7 deterministic arcs mirrored around one origin `(600,64)` — all start at the **same** point, end symmetrically; one calm radial glow at `.16 → 0` opacity |
| Directional | `preserveAspectRatio="xMidYMid meet"` (no distortion), symmetric geometry ⇒ RTL-neutral |
| Motion | Static by construction; explicit reduced-motion guards at `app-mock.css:205-211` |

---

## 3. Source guards / الحواجز

`tests-v1140-app-mock-fidelity.mjs` asserts:

1. every exact lucide identifier used by `Rail.tsx` is present in `page.tsx`;
2. all rail names/numbers (`00..16` incl. the real gaps `12/14`) are present;
3. **exactly one** `@keyframes appmock-cursor-path` across `page.tsx` +
   `home.css` and no guessed `cqw` waypoint left in that keyframe;
4. no `Math.random` / `new Date` / `Date.now` in `APP_MOCK_MOTION`;
5. **three** motion gates: OS media query, `html.reduce-motion`,
   `html[data-art='off']`;
6. the silk fan has no randomness and is index-derived.

Run: `node tests-v1140-app-mock-fidelity.mjs` (from the repository root), plus
`cd website && npx tsc --noEmit && npm run build`.

---

## 4. Note on honesty / ملاحظة الصدق

The mock stays a **static illustration** — its caption already says
"a stylised illustration, not a screen recording". Every label, icon, number
and control is copied from the real source; nothing is simulated with timers
or random data. The only JS is two effects: one flips a single `data-in`
attribute on intersection, the other publishes measured element centres as
CSS variables for the pointer. Neither creates render-time nondeterminism.

النسخة **رسم توضيحي ثابت** وليس تسجيل شاشة (هذا مذكور في التسمية أسفلها). كل
تسمية وأيقونة ورقم وعنصر منقول من الكود الحقيقي، بلا مؤقتات أو أرقام عشوائية.

---

## 5. تدقيق X6 — الإصلاحات / X6 audit fixes (exact lines)

| ID | Removal / fix | Exact location |
|---|---|---|
| **C1** | Deleted the duplicate `@keyframes appmock-cursor-path` (14 cqw waypoints) and `@keyframes appmock-click-pulse` (two pulses), plus their three `.appmock-stage[data-in='true'] … cursor` / `::after` selectors | `website/app/home.css:552` — deletion record; old block was `:563-598` pre-fix |
| **C1** | Deleted the competing `.appmock-cursor` base rule (`--mx/--my`, 20×24, guessed `translate3d(31cqw,74cqw)`) and the `:empty::before` duplicated arrow | `website/app/home.css:526-532` (replaced by the ring-only comment + `::after` base) |
| **C1** | Renamed the single authoritative keyframe to the canonical `appmock-cursor-path`; ripple/ring stay on the same clock | `website/app/page.tsx:294,297,300,303` |
| **C4** | Removed the second `.appmock-send` (32px/8px) + `.appmock-send svg` 16px + `.appmock-mic svg` 15px declarations | `website/app/home.css:487-490` (removal record) |
| **C4** | Consolidated to one `.appmock-send svg` (16px) and one `.appmock-cursor>svg` (18×22); all other toolbar glyphs 15px | `website/app/home.css:615-616, 626` |
| **C5** | Confirmed fixed by the owning agent: `--am-ink:#0c1103` removed; art layer now owns only `--art-cadence` and app-mock keeps `#E9EEF6` | `website/app/art-motion.css:13-18, 32`; `website/app/home.css:303` (unchanged) |
| **C6** | One cadence family: `--art-cadence:2.8s`, `AM_CADENCE_MS=2800`, `AM_BEAT_UNIT=400ms`; orbit spin uses one cadence (was 2.2s), pointer/ripple/ring use `×4` (11.2s, was 9.2s) | `website/app/art-motion.css:32`; `website/app/page.tsx:234-240, 285, 294/297/300` |
| **C6** | Every reveal delay is now an integer cadence unit (`d: 7..18`) via `beat(units)`, not a free literal | `website/app/page.tsx:189-195, 224-228, 872` |

Verification: `node tests-v1140-app-mock-fidelity.mjs` (32 PASS), `node
website/tests-app-demo.mjs` (11 PASS / 0 FAIL), `cd website && npx tsc --noEmit
&& npm run build` — all green.

التحقق: الحواجز الثلاثة و TypeScript والبناء كلها ناجحة.
