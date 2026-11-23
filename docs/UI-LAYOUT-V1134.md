# UI LAYOUT GUARD — v11.34 (V7) / حارس تخطيط الواجهة — v11.34 (V7)

_اختبار: `tests/v1134-ui-guard.test.mjs` · تشغيل: `node --test --test-force-exit tests/v1134-ui-guard.test.mjs`_
_test: `tests/v1134-ui-guard.test.mjs` · run: `node --test --test-force-exit tests/v1134-ui-guard.test.mjs`_

---

## الحكم (Arabic)

**أخضر — PASS، بصراحة.** ١٤ من ١٤ فحصاً نجحوا، صفر فشل. V7 نزل فعلياً في المصدر هذا الحارس لا يصلّح شيءًا — يقرأ المصدر الحقيقي ويحزم المكوّنات الحقيقية بالـ esbuild ويعرضها بـ SSR ويفحص الـ onClick الحقيقي. الثلاثة مطالب كلها موجودة، والعقد القديم (chat يسار / rail أعلى، التركيز بالحجم الطبيعي، ثنائي اللغة، تقليل الحركة) ما انكسر.

**بس كونوا صادقين مع أنفسكم:** كل هذا فحص **مصدر + SSR**، لا متصفح ولا لقطة شاشة ولا `getComputedStyle`. SSR ما عنده محرّك تخطيط — ما يقدر يشوف زر ٢٢px مقابل شريط عريض، ولا يتأكد إن الـ 80% فعلاً تظهر على شاشتك. «الاختبارات خضراء» و«الشكل صحيح بالعين» متغيّران مستقلان في هذا المستودع (`CHAT-VISUAL-TRUTH-V1124.md:19`). الحكم الأخضر يعني **العقد مُثبت في الكود**، لا أن المؤسس رأى النتيجة بعينه.

### ما نجح — بأرقام الأسطر

| الفحص | النتيجة | الدليل (file:line) |
|---|---|---|
| A1 — شريط الخطة صار `<button>` مع معالج حقيقي | ✅ | `src/components/ChatPanel.tsx:270-285` — `plan-toggle` + `onClick={() => setOpen(...)}` |
| A2 — صفوفTodo والمقياس مخفية خلف حالة `open` | ✅ | `src/components/ChatPanel.tsx:286-293` — `{open && <div className="plan-detail">…<TodoRows/>…}` |
| A3 — SSR: زر واحد صغير، بلا شريط عريض (`todo-meter` / `ts-plan-*`) | ✅ | SSR من `PlanCard` — `<button>` واحد، صفر صفوف轴线 |
| A4 — الـ onClick معالج دالة فعلية (مُلتقط، ليس ميتاً) | ✅ | `src/components/ChatPanel.tsx:273` |
| B1 — الحد الأقصى ≥ 75% من النافذة | ✅ | `src/components/ChatPanel.tsx:86-99` — `CHAT_MAX_FRACTION = 0.8`، `effectiveChatMax() = vw*0.8` |
| B2 — نقرة مزدوجة تُعيد توازناً 55/45 لا أقصى/أدنى | ✅ | `src/components/ChatPanel.tsx:101-106,1124-1127` — `balancedChatWidth()` |
| B3 — المقبض متاح بلوحة المفاتيح (tabIndex + onKeyDown + ARIA + إنذار ثنائي اللغة) | ✅ | `src/components/ChatPanel.tsx:1494-1508`, `src/i18n.ts:1654-1655` |
| C1 — أحجام خط المحادثة كُبّرت مقابل الأساس (قيم px مصدرية) | ✅ | `src/components/type-scale.css:64-66` — `15.5 / 15 / 13.5px` (كانت `14 / 14.6 / 13`) |
| C2 — جسم الرسالة ما زال يستهلك `var(--chat-base)` | ✅ | `src/components/console.css:43,49` |
| C3 — خط العرض ما زال Instrument Serif | ✅ | `src/styles/tokens.css:63`, `src/styles.css:74`, `src/assets/glass-v7.css:61` |
| D1 — chat يسار / rail أعلى سليم | ✅ | `src/components/shell.css:30-38,42-46`, `src/App.tsx:345,348` |
| D2 — التركيز بالحجم الطبيعي (بلا إطار/قياس/حواشٍ) | ✅ | `src/components/shell.css:67-72`, `src/App.tsx:227` |
| D3 — ثنائي اللغة EN/AR سليم | ✅ | `src/i18n.ts:288,1654-1655`, `src/components/ChatPanel.tsx:279` عبر `t()` |
| D4 — بوابتا تقليل الحركة موجودتان | ✅ | `src/components/chat-final.css:28,40`, `src/components/type-scale.css:151,155` |

### تحفّطان يستحقان الانتباه / Two honest caveats

1. **الحد الأقصى ليس 80% دائماً.** `effectiveChatMax()` (`ChatPanel.tsx:97`) يأخذ `min(vw*0.8, vw-280)` — أي أن النافذة الأضيق من ~1400px تُقيد بـ `vw-280`. عند 1280px هذا ≈ 1000px (78%)، وهذا ضمن نطاق 75–80% المطلوب. لكن عند نوافذ صغيرة جداً (< ~1120px) قد يهبط تحت 75% لأن مساحة العمل محمية بـ 280px. هذا قرار تصميمي مقصود، لا فشل اختبار.
2. **زيادة الخط عبر أولوية المُحدِّد، لا بتعديل الأساس.** `console.css:21` ما زال `--chat-base: 14px`. الزيادة الحقيقية تأتي من `html .chat-panel-root` في `type-scale.css:61-67` الذي يفوز بسبب specificity أعلى بغض النظر عن ترتيب الـ import (`styles.css:1,11`). تعمل، لكن أي شخص يقرأ `console.css:21` وحده سيظن أن الخط لم يكبر.

---

## Verdict (English)

**GREEN — PASS, bluntly.** 14/14 checks pass, zero failures. V7 has genuinely landed in source. This guard edits nothing — it reads the real source, bundles the real components with esbuild, SSRs them, and inspects the real `onClick`. All three founder demands are present, and the old contract (chat LEFT / rail TOP, natural-size focus, bilingual EN/AR, reduced-motion) is unbroken.

**But be honest with yourselves:** this is **source + SSR** verification only — no browser, no screenshot, no `getComputedStyle`. SSR has no layout engine; it cannot see a 22px toggle versus a wide strip, nor confirm that 80% actually renders on your monitor. "Tests green" and "looks right to the eye" are independent variables in this repo (`CHAT-VISUAL-TRUTH-V1124.md:19`). Green here means **the contract is proven in code**, not that the founder has eyeballed the result.

### What passed — with file:line

| Check | Result | Evidence (file:line) |
|---|---|---|
| A1 — plan strip is a `<button>` with a real handler | ✅ | `src/components/ChatPanel.tsx:270-285` — `plan-toggle` + `onClick={() => setOpen(...)}` |
| A2 — TodoRows + meter are gated behind `open` | ✅ | `src/components/ChatPanel.tsx:286-293` — `{open && <div className="plan-detail">…}` |
| A3 — SSR: one small button, no wide strip (`todo-meter` / `ts-plan-*`) | ✅ | SSR of `PlanCard` — one `<button>`, zero todo rows |
| A4 — onClick is a real function (captured, not dead) | ✅ | `src/components/ChatPanel.tsx:273` |
| B1 — resize max ≥ 75% of window | ✅ | `src/components/ChatPanel.tsx:86-99` — `CHAT_MAX_FRACTION = 0.8`, `effectiveChatMax() = vw*0.8` |
| B2 — double-click resets to a 55/45 balance, not an extreme | ✅ | `src/components/ChatPanel.tsx:101-106,1124-1127` — `balancedChatWidth()` |
| B3 — keyboard-accessible handle (tabIndex + onKeyDown + ARIA + bilingual hint) | ✅ | `src/components/ChatPanel.tsx:1494-1508`, `src/i18n.ts:1654-1655` |
| C1 — chat font sizes increased vs baseline (source px) | ✅ | `src/components/type-scale.css:64-66` — `15.5 / 15 / 13.5px` (was `14 / 14.6 / 13`) |
| C2 — message body still consumes `var(--chat-base)` | ✅ | `src/components/console.css:43,49` |
| C3 — display face still Instrument Serif | ✅ | `src/styles/tokens.css:63`, `src/styles.css:74`, `src/assets/glass-v7.css:61` |
| D1 — chat LEFT / rail TOP intact | ✅ | `src/components/shell.css:30-38,42-46`, `src/App.tsx:345,348` |
| D2 — natural-size focus mode (no frame/measure/gutter) | ✅ | `src/components/shell.css:67-72`, `src/App.tsx:227` |
| D3 — bilingual EN/AR intact | ✅ | `src/i18n.ts:288,1654-1655`, `src/components/ChatPanel.tsx:279` via `t()` |
| D4 — both reduced-motion gates present | ✅ | `src/components/chat-final.css:28,40`, `src/components/type-scale.css:151,155` |

### Two honest caveats

1. **The max is not always 80%.** `effectiveChatMax()` (`ChatPanel.tsx:97`) takes `min(vw*0.8, vw-280)` — the work area keeps a protected 280px floor. At 1280px that is ≈1000px (78%), inside the requested 75–80% band. On very narrow windows (< ~1120px) it can fall below 75% because the 280px work floor wins. That is a deliberate design decision, not a test failure.
2. **The font bump lands via specificity, not by editing the baseline.** `console.css:21` still reads `--chat-base: 14px`. The real increase comes from `html .chat-panel-root` in `type-scale.css:61-67`, which wins on specificity regardless of import order (`styles.css:1,11`). It works — but anyone reading `console.css:21` alone will wrongly conclude the font was never enlarged.

---

## Method / الطريقة

- Source assertions run on **comment-stripped** text with byte length preserved, so every failure prints an exact `file:line`.
- The real `store` + `ChatPanel` are bundled with esbuild; an in-memory-only plugin appends exports for the module-private plan component (the real file is never touched). SSR uses `renderToStaticMarkup`; `react/jsx-runtime` is wrapped to capture JSX elements so the plan button's real `onClick` can be inspected without a DOM library.
- No application source was modified by this guard. To diagnose a regression, re-run the command at the top and read the `file:line` in each failure message.
- تأكيدات المصدر تعمل على نصّ مُجرّد من التعليقات مع الحفاظ على طول البايت، لذا كل فشل يعطي `file:line` دقيقاً. الحارس لم يعدّل أي ملف مصدر.

_Re-run after any further UI edit: `node --test --test-force-exit tests/v1134-ui-guard.test.mjs` — expect 14/14._
_أعد التشغيل بعد أي تعديل واجهة لاحق: `node --test --test-force-exit tests/v1134-ui-guard.test.mjs` — المتوقع ١٤/١٤._
