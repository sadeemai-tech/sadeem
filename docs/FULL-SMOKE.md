# FULL SURFACE SMOKE — تقرير فحص كل الأقسام

> v11.21 · **المصدر:** `tests/v1121-full-smoke.test.mjs` (ملف اختبار فقط — لم يتم تعديل أي ملف من ملفات التطبيق).
> **الأمر:** `node --test --test-force-exit tests/v1121-full-smoke.test.mjs`
> **آخر تشغيل:** 60/60 اختبار ناجح · 54 شاشة · **0 انهيار · 0 محدد غير مستقر · 0 عنصر ميت** (من 535 عنصراً تم فحصه).

---

## 1. الخلاصة — Executive summary (AR)

بناءً على طلب المؤسس «تأكد من كل الأقسام بأنها تعمل، لأنه المشاكل هاي مصيبة»، تم بناء منصة اختبار تقوم بـ:

1. **تغليف (bundle) وSSR لكل شاشة** عبر esbuild مع واجهة `window.surnia` وهمية ومتجر (store) حقيقي مُهيّأ ببيانات ثابتة.
2. **كشف نمط React #300** (المُحدِّد غير المستقر) على مستويين: فحص الكود المصدري لأي `useStore((s) => ({...}))` / `useStore((s) => [...])` / اشتقاق مصفوفة جديدة، واعتراض تحذيرات `console.error` أثناء الرسم.
3. **فحص كل زر/عنصر تفاعلي** تأكيداً من وجود `onClick`/`onChange` مرتبط برمز حقيقي (وليس `() => {}` أو TODO).
4. **اختبارات ذاتية للكاشفات** حتى لا تكون النتيجة الخضراء ناتجة عن كاشف معطّل.

**النتيجة الصادقة:** كل الشاشات الـ54 رُسمت دون استثناء، ولا يوجد حالياً أي أثر لنمط React #300 في الكود المصدري — بما فيه `SkillsPanel` الذي أبلغ المؤسس عن انهياره. يُرجّح أنه أُصلح بالفعل على يد وكيل آخر؛ الكاشف موجود كحاجز ارتداد (regression guard). **لكن هذا لا يُثبت أن الانهيار اختفى في المتصفح الحقيقي** — انظر P0 أدناه.

### ملاحظات صادقة مهمة — Honest caveats (AR)

- **SSR لا يُعيد إنتاج React #300 منفرداً**: الخطأ #300 هو حلقة إعادة رسم في المتصفح (client render loop). الرسم على الخادم يستدعي المُحدِّد مرة واحدة فقط؛ لذلك الفحص المصدرى هو الأداة الحقيقية هنا، وهو نظيف حالياً. يلزم تأكيد في متصفح Electron حقيقي.
- **`WhatsNew` لا يُنتج HTML في SSR** لأن ظهوره محكوم بـ `useEffect` (لا ينفّذ على الخادم). هذا ليس انهياراً لكنه يعني أن محتواه لم يُختبر فعلياً.
- **Monaco / xterm / bridge مُستبدلة بنسخ وهمية** (stubs). الاختبار يثبت أن الشاشة لا تُرمي استثناءً، وليس أن محرر Monaco أو الطرفية يعملان فعلياً.
- **أثناء تطوير المنصة ظهرت 3 انهيارات وهمية** في `ChatPanel` و`BillingSection` و`AccountAuthCard`؛ تبيّن أنها أخطاء في بيانات الاختبار (`fileTree` كان مصفوفة بدل عقدة `FileNode` واحدة، و`account` lacked `id`). تم تصحيح بيانات الاختبار — لم تكن عيوباً في التطبيق. ذكرناها هنا حتى لا يُعاد الإبلاغ عنها.

---

## Executive summary (EN)

Per the founder's instruction ("make sure every section works, because these problems are a disaster"), this harness:

1. **Bundles and SSR-renders every major screen** with esbuild, a mocked `window.surnia` bridge, and the real store seeded with deterministic data.
2. **Detects React #300 unstable selectors** two ways: a source-level scan (`useStore((s) => ({...}))`, array literals, fresh derived collections) and interception of `console.error` warnings during render.
3. **Scans every interactive control** for a real `onClick`/`onChange` wiring (rejecting `() => {}` / TODO / no-op).
4. **Self-tests the detectors** so a green result can't come from a broken detector.

**Honest result:** all 54 screens render without throwing; no unstable selector exists in the current source — including `SkillsPanel`, the founder-reported crash site. It appears to have been fixed already by another agent; the detector remains as a regression guard. **This does not prove the crash is gone in the real browser** — see P0.

### Honest caveats (EN)

- **SSR cannot reproduce React #300 on its own**: #300 is a client-side re-render loop; the server renderer calls a selector once. The source scan is the real detector here and it is clean. Real Electron-browser verification is still required.
- **`WhatsNew` emits no HTML under SSR** because visibility is set in `useEffect`. Not a crash, but its content was not exercised.
- **Monaco / xterm / bridge are stubbed**: the test proves "render does not throw", not that the editor/terminal actually work.
- **Three transient "crashes" appeared while building the harness** (`ChatPanel`, `BillingSection`, `AccountAuthCard`). They were harness seed-shape mistakes (`fileTree` array instead of a single `FileNode`, and a missing `account.id`), corrected in the harness. They are not application bugs and are documented so they are not re-reported.

---

## 2. النتائج التفصيلية — Per-screen results

الحالة: `RENDERS OK` = رسم دون استثناء · `CRASHES` = استثناء أثناء الرسم · `UNTESTABLE` = تعذّر التغليف/الرسم لأسباب المنصة.
"عناصر" = عدد عناصر التحكم المكتشفة في ملف المصدر · "#300" = عدد المُحدِّدات غير المستقرة · "CRM" = عدد النصوص المرسومة.

| # | الشاشة / Screen | المجموعة | الحالة / Status | CRM | عناصر | #300 | ملاحظات |
|---:|---|---|---|---:|---:|---:|---|
| 1 | ChatPanel | core | RENDERS OK | 25278 | 41 | 0 | أكبر شاشة، تشمل Composer/MessageView |
| 2 | Home | core | RENDERS OK | 9886 | 7 | 0 | |
| 3 | Onboarding | core | RENDERS OK | 13758 | 7 | 0 | اختُبر مع `onboardingOpen: true` |
| 4 | AuthScreen | core | RENDERS OK | 7087 | 10 | 0 | |
| 5 | Welcome | core | RENDERS OK | 14919 | 7 | 0 | |
| 6 | WhatsNew | core | RENDERS OK* | 0 | 2 | 0 | *SSR no-op: الظهور عبر `useEffect` |
| 7 | CommandPalette | core | RENDERS OK | 7096 | 2 | 0 | `open: true` |
| 8 | SettingsModal | core | RENDERS OK | 46333 | 8 | 0 | `settingsOpen: true` |
| 9 | DiffView | core | RENDERS OK | 2383 | 3 | 0 | نص Diff عادي |
| 10 | DiffModal | core | RENDERS OK | 4958 | 8 | 0 | `diffView` مُهيّأ |
| 11 | EditorArea | core | RENDERS OK | 4026 | 13 | 0 | Monaco مُستبدل |
| 12 | WorkspacePanel | rail | RENDERS OK | 25851 | 23 | 0 | |
| 13 | SessionsPanel | rail | RENDERS OK | 8318 | 13 | 0 | |
| 14 | GitPanel | rail | RENDERS OK | 1702 | 15 | 0 | |
| 15 | MCPPanel | rail | RENDERS OK | 7304 | 59 | 0 | أكثر لوحة عناصر تفاعلية |
| 16 | UsagePanel | rail | RENDERS OK | 18711 | 2 | 0 | |
| 17 | DnaPanel | rail | RENDERS OK | 6854 | 10 | 0 | |
| 18 | FlowsPanel | rail | RENDERS OK | 3257 | 14 | 0 | |
| 19 | **SkillsPanel** | rail | **RENDERS OK** | 5773 | 23 | **0** | **موقع الانهيار المُبلَّغ — نظيف حالياً** |
| 20 | ArtifactsPanel | rail | RENDERS OK | 5242 | 4 | 0 | |
| 21 | LibraryPanel | rail | RENDERS OK | 7651 | 8 | 0 | |
| 22 | WikiPanel (initialTab=wiki) | rail | RENDERS OK | 3093 | 8 | 0 | من `registry.tsx` |
| 23 | PromptsPanel | rail | RENDERS OK | 2604 | 13 | 0 | |
| 24 | SearchPanel | rail | RENDERS OK | 3008 | 7 | 0 | |
| 25 | SubagentsPanel | rail | RENDERS OK | 14897 | 6 | 0 | |
| 26 | WikiPanel (component) | rail | RENDERS OK | 1918 | 3 | 0 | إضافي |
| 27 | SchedulePanel | rail | RENDERS OK | 5605 | 22 | 0 | إضافي |
| 28 | SecurityPanel | rail | RENDERS OK | 11078 | 3 | 0 | إضافي |
| 29 | GeneralSection | settings | RENDERS OK | 11260 | 11 | 0 | |
| 30 | AppearanceSection | settings | RENDERS OK | 13279 | 12 | 0 | |
| 31 | NotificationsSection | settings | RENDERS OK | 1549 | 2 | 0 | |
| 32 | VoiceSection | settings | RENDERS OK | 4312 | 8 | 0 | |
| 33 | AgentSection | settings | RENDERS OK | 32157 | 16 | 0 | |
| 34 | PrivacySection | settings | RENDERS OK | 23420 | 9 | 0 | |
| 35 | SkillsMemorySection | settings | RENDERS OK | 4959 | 4 | 0 | |
| 36 | ModelsSection | settings | RENDERS OK | 15006 | 15 | 0 | |
| 37 | ModelsSection (providersOnly) | settings | RENDERS OK | 12397 | 15 | 0 | |
| 38 | McpSection | settings | RENDERS OK | 5934 | 6 | 0 | |
| 39 | PluginsSection | settings | RENDERS OK | 4290 | 8 | 0 | |
| 40 | ApiServerSection | settings | RENDERS OK | 9102 | 9 | 0 | |
| 41 | RemoteSection | settings | RENDERS OK | 3963 | 5 | 0 | |
| 42 | PreviewSection | settings | RENDERS OK | 5165 | 6 | 0 | |
| 43 | EditorSection | settings | RENDERS OK | 5599 | 6 | 0 | |
| 44 | TerminalSection | settings | RENDERS OK | 5398 | 4 | 0 | |
| 45 | GitWorktreeSection | settings | RENDERS OK | 2741 | 4 | 0 | |
| 46 | BillingSection | settings | RENDERS OK | 8566 | 6 | 0 | |
| 47 | ShortcutsSection | settings | RENDERS OK | 10549 | 4 | 0 | |
| 48 | EvidenceSection | settings | RENDERS OK | 4170 | 2 | 0 | |
| 49 | LogsSection | settings | RENDERS OK | 4187 | 4 | 0 | |
| 50 | UpdatesSection | settings | RENDERS OK | 3034 | 5 | 0 | |
| 51 | FeedbackSection | settings | RENDERS OK | 4661 | 7 | 0 | |
| 52 | AdvancedSection | settings | RENDERS OK | 8144 | 6 | 0 | |
| 53 | ApprovalsSection | settings | RENDERS OK | 2651 | 3 | 0 | |
| 54 | AccountAuthCard | settings | RENDERS OK | 2613 | 17 | 0 | |

**المجموع / Totals:** 54 شاشة · `RENDERS OK` = 54 · `CRASHES` = 0 · `UNTESTABLE` = 0 · 535 عنصراً مفحوصاً · 0 عنصر ميت · 0 مُحدِّد غير مستقر.

### dead controls / العناصر الميتة
**لا يوجد.** لم يتم العثور على أي زر أو حقل دون `onClick`/`onChange`، ولا أي معالج فارغ `() => {}` أو معلق على TODO، في أي من ملفات الشاشات الـ54.
There are **no** dead controls: every one of the 535 scanned controls (raw `<button>/<input>` plus the project's `<Btn>`, `<IconBtn>`, `<Toggle>`, `<Slider>`, `<Segmented>`, `<Select>`, `<TextInput>`) has a wired handler. Any future regression is reported with exact `file:line`.

---

## 3. P0 — مهام حرجة يجب تأكيدها يدوياً / Critical manual follow-ups

| # | المهمة (AR) | Task (EN) | لماذا P0 / Why |
|---|---|---|---|
| P0-1 | افتح Skills panel في Electron حقيقي وتأكد من عدم ظهور React #300 في الـconsole. | Open the Skills panel in a real Electron window and confirm no React #300 in the console. | الانهيار الأصلي كان في المتصفح؛ SSR + فحص المصدر لا يُعيدان إنتاج حلقة إعادة الرسم. The original crash was client-side; SSR/source scan cannot reproduce a render loop. |
| P0-2 | تحقّق من `WhatsNew` مع حساب فعلي و`booted=true` و`lastSeenVersion` قديم. | Verify `WhatsNew` with a real account, `booted=true`, and an old `lastSeenVersion`. | الشاشة `useEffect`-gated ولا تُنتج HTML في SSR. It is effect-gated and emits nothing under SSR. |
| P0-3 | أعد تشغيل هذا الاختبار بعد أن تنهي الوكلاء الآخرون تعديلاتهم على المصدر. | Re-run this suite after the other agents finish their source edits. | النتيجة الحالية مرتبطة بحالة المصدر وقت التشغيل. The result is bound to the source state at run time. |
| P0-4 | تأكد أن محرر Monaco والطرفية يعملان فعلياً في التطبيق (خارج نطاق SSR). | Confirm Monaco editor and terminal work in the real app (outside SSR scope). | تم استبدالهما بـ stubs هنا. They are stubbed in this harness. |

> **لا يوجد P0 مفتوح داخل نطاق هذا الاختبار:** كل الشاشات رُسمت، ولا يوجد محدد غير مستقر أو عنصر ميت في المصدر الحالي.
> **No open P0 within this harness' scope:** every screen renders; no unstable selector or dead control exists in the current source.

---

## 4. المنهجية والقيود — Method & limitations (EN)

- **Bundling:** one esbuild bundle per screen (React/zustand/lucide-react/xterm externalized; Monaco/lottie/qrcode/`?worker` stubbed), so a failure is isolated to one screen.
- **Store:** the real `useStore` is bundled and seeded; `React.useSyncExternalStore` is patched so SSR reads the **live** snapshot (zustand v5 otherwise reads `getInitialState()` and every gated surface renders as `null`).
- **Bridge:** `window.surnia` is a Proxy returning resolved promises for every method.
- **Coverage gate:** a test parses `panels/registry.tsx` and `SettingsModal.tsx` and asserts every registered panel/section appears in the screen inventory.
- **Not covered:** real browser events, effects, timers, network, Monaco/xterm internals, visual layout. "RENDERS OK" means *render does not throw*, not *feature is functional*.
- **Artifacts:** machine-readable results at `os.tmpdir()/sadeem-v1121-full-smoke/results.json` and `crashes.log`; transient bundles are written under `tests/` and deleted in `after()`.

## 5. طريقة التشغيل — How to run (AR/EN)

```bash
node --test --test-force-exit tests/v1121-full-smoke.test.mjs
# or: npm test   (glob tests/*.test.mjs includes this file)
```

Exit code `0` = كل الشاشات رُسمت ولا عناصر ميتة · `1` = يوجد انهيار أو عنصر ميت أو محدد غير مستقر (التفاصيل في `crashes.log` ومخرجات الاختبار).
