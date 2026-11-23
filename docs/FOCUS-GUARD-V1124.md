# FOCUS-GUARD v11.24 — حارس وضع التركيز

Diagnosis + test only. No application source was edited by this guard.
تشخيص واختبار فقط. لم يعدّل هذا الحارس أي ملف من ملفات التطبيق.

---

## 1 · verdict / الحكم

**EN — PASS, bluntly.** Focus mode does exactly what the founder asked and nothing
else: the work area and the splitter disappear, the chat keeps its **natural full
size and position** (chat LEFT, rail TOP), and there is **no shrunken screen, no
framed reading column, no gutter, no border/radius/shadow, no backdrop, no
centering**. All **9/9** assertions pass. Zero restrictive declarations survive.

**AR — نجاح، وبوضوح مباشر.** وضع التركيز يفعل بالضبط ما طلبه المؤسس ولا شيء أكثر:
تختفي مساحة العمل والفاصل، وتحتفظ المحادثة بـ**حجمها وموقعها الطبيعيّين**
(المحادثة يسار، الشريط أعلى)، و**لا يوجد تصغير للشاشة، ولا عمود قراءة مؤطَّر،
ولا هوامش، ولا حدود/استدارة/ظل، ولا خلفية ضبابية، ولا توسيط**. كل الاختبارات
**٩/٩** ناجحة، ولا تبقّت أي قاعدة تقييدية.

---

## 2 · exact counts / الأرقام الدقيقة

| metric / القياس | value / القيمة |
|---|---|
| focus rules in `shell.css` / قواعد التركيز | **3** |
| hide rules (`display:none !important`) / قواعد الإخفاء | **2** |
| natural-size flex rules (`flex:1 1 auto`) / قواعد التمدد الطبيعي | **1** |
| total declarations in focus rules / إجمالي التصريحات | **3** |
| restrictive declarations found / القواعد التقييدية المكتشفة | **0** |
| tests run / الاختبارات المنفذة | **9** |
| passed / فاشل | **9 / 0** |
| focus block span / نطاق كتلة التركيز | `shell.css:67–72` |

---

## 3 · leftover restrictive rule / القاعدة التقييدية المتبقية

**EN — NONE.** The scan looked for `max-width`, `min-width`, `width`, `height`,
`padding` (incl. `padding-inline`), `margin`, `border` (incl. `border-radius`),
`box-shadow`, `backdrop`, centering, `transform`, `filter`, `contain`,
`background`, gradients, `color-mix`, and `--focus-*` tokens — **zero hits**.
No `file:line` to report because there is no offending rule.

**AR — لا شيء.** فحصنا `max-width` و`min-width` و`width` و`height` و`padding`
(بما فيه `padding-inline`) و`margin` و`border` (بما فيه `border-radius`) و
`box-shadow` و`backdrop` والتوسيط و`transform` و`filter` و`contain` و
`background` والتدرّجات و`color-mix` ورموز `--focus-*` — **صفر نتائج**. لا يوجد
`file:line` لأن لا توجد قاعدة مخالفة.

---

## 4 · the only intended behaviour / السلوك الوحيد المقصود

`src/components/shell.css:67–72` — verified verbatim:

```css
html[data-focus='on'] .app-main-row-v12 > .chat-slot-v12 {
  flex: 1 1 auto !important;
}
html[data-focus='on'] .chat-resizer { display: none !important; }
html[data-focus='on'] .app-main-row-v12 > .work-slot-v12 { display: none !important; }
```

EN: hiding `work-slot` + `chat-resizer` is the entire behaviour. The single
`flex:1 1 auto` rule only lets the surviving chat fill the row at natural size —
it does not touch the chat panel's look or geometry.

AR: إخفاء `work-slot` و`chat-resizer` هو السلوك بأكمله. قاعدة `flex:1 1 auto`
الوحيدة تسمح فقط للمحادثة الباقية بملء الصف بحجمها الطبيعي، دون المساس بمظهر
لوحة المحادثة أو هندستها.

---

## 5 · contracts confirmed / العقود المؤكدة

- **chat LEFT / rail TOP** — chat slot `order:1; flex:0 0 auto` and work slot
  `order:2; flex:1 1 auto` intact (`shell.css:42–54`); rail bar full width
  (`shell.css:30–38`); chat panel keeps its normal hairline (`shell.css:57`).
  JSX keeps `<Rail />` above the row, `<div className="chat-slot-v12">` before
  `{workArea}`, and mirrors the flag to `document.documentElement.dataset.focus`
  (`App.tsx:227, 239, 345, 348`).
- **both reduced-motion guards** — OS guard in `shell.css:277`; in-app
  `html.reduce-motion .brand-display` and OS guard in `type-scale.css:151, 155`.
- **chat panel never re-styled** — no focus selector targets `chat-panel-root`
  or any descendant; no framed reading-column selector survives.

**AR**
- **المحادثة يسار / الشريط أعلى** — قواعد الترتيب والتمدد سليمة
  (`shell.css:42–54`)، والشريط بعرض كامل (`shell.css:30–38`)، ولوحة المحادثة
  تحتفظ بخطها الرفيع العادي (`shell.css:57`). وJSX يحافظ على موضع الشريط
  والمحادثة ويُسقط علم التركيز على عنصر الجذر (`App.tsx:227, 239, 345, 348`).
- **حارسان لتقليل الحركة** — حارس نظام التشغيل في `shell.css:277`، والحارس
  الداخلي وحارس النظام في `type-scale.css:151, 155`.
- **لوحة المحادثة لا تُعاد تهيئتها أبدًا** — لا أي محدد تركيز يستهدف
  `chat-panel-root` أو أحفادها، ولا عمود قراءة مؤطَّر.

---

## 6 · reproduce / إعادة التشغيل

```powershell
node --test tests/v1124-focus-guard.test.mjs
```

Expected: `tests 9 / pass 9 / fail 0`. The report block is printed at the top of
the TAP output.
المتوقع: `tests 9 / pass 9 / fail 0`، وتظهر كتلة التقرير في أعلى مخرجات TAP.

---

## 7 · scope note / ملاحظة النطاق

This guard reads source only; it never writes to `shell.css`, `type-scale.css`,
or `App.tsx`. If a future edit reintroduces a measure, frame, gutter, or
centering rule inside the focus block, test **2** fails and prints the exact
`file:line` of every offending declaration.
هذا الحارس يقرأ الملفات فقط ولا يكتب أبدًا إلى `shell.css` أو `type-scale.css`
أو `App.tsx`. إذا أعاد تعديل لاحق إدخال قياس أو إطار أو هامش أو توسيط داخل كتلة
التركيز، يفشل الاختبار **٢** ويطبع `file:line` الدقيق لكل تصريح مخالف.
