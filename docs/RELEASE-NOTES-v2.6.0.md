# ملاحظات الإصدار — سورنيا v2.6.0 / Release Notes — Surnia v2.6.0

السجل الكامل: [README-v2.6.0.md](../README-v2.6.0.md)

---

## ما الذي أُصلح / What got fixed

- **دردشة عربية/RTL سليمة بالكامل** — كل عنصر كتلي يأخذ اتجاهه بنفسه (`dir="auto"` + `unicode-bidi: plaintext`)؛ النقطتان والأرقام لم تعد تتنقّل بين الأسطر.
  Per-block bidi in chat markdown — colons and numbers no longer scramble.
- **الغات الكود معزولة LTR** مع نمط `.kb-code` كامل — شريحة اللغة وزر النسخ كانا بلا أي أنماط ويتصادمان؛ صارا عنصرين مصمّمين فعلًا.
  Code blocks hard-isolated LTR with a complete `.kb-code` style — the lang chip and copy button finally have real styles.
- **محرر Monaco يعمل في الوضع العربي** — كان فراغًا أسود؛ عزل LTR الصارم هو حل فريق Monaco نفسه، وطُبّق أيضًا على DiffEditor وعقد xterm.
  Monaco renders in Arabic mode (was a black void) — hard-LTR isolation per the Monaco team's own fix; same for DiffEditor and xterm nodes.
- **رأس وحدة الوكيل لم يعد ينقطع** — أزرار الملخص/تصدير HTML/المراجعة/المهارات/الضغط انتقلت إلى قائمة "⋯".
  Agent console header decongested — recap/html-export/review/skills/compact moved into a "⋯" overflow menu.
- **الاستيفاء في الترجمة صُحّح** — العناصر `{n}` لم تعد تظهر حرفيًا في سطر الحالة العربي؛ `t()` تدعم المعاملات.
  i18n interpolation fixed — `{n}` placeholders no longer render literally; `t()` supports params.
- **صندوق الكتابة آمن ثنائي الاتجاه** — رمزا `@` و`/` مُلزمان بـ RLM في التلميح العربي، وإصلاحات اتجاه لشرائح الأوامر المائلة ومفتاح أنواع الملفات وصفوف الجلسات (سبب التصاق spans حُدد وأُصلح).
  Bidi-safe composer — RLM-glued @/ sigils, dir fixes for slash chips, file-type legend and session rows (inline-span jam root-caused).
- **لا حلقات انهيار على كروت ضعيفة** — أي انهيار للمُصيّر على SwiftShader يفعّل قاطعًا دائمًا (`userData/surnia-fx-off`) ويعيد النافذة فورًا بوضع `html.fx-off` دون ضباب أو حركة.
  SwiftShader crash-resilience — a persisted circuit breaker reloads the app degraded (`html.fx-off`) instead of crash-looping.
- **إعجاب/عدم إعجاب أُعيد بناؤه** — حالة محفوظة، تسجيل واحد لكل رسالة، إخفاق صادق يسمح بإعادة المحاولة، تدفق ملاحظة بـ Enter/Escape، والحالة تستعاد بين الجلسات.
  Likes/dislikes reworked — persistent state, one record per message, honest failure states, Enter/Escape note flow, re-hydrated across sessions.
- **شاشة الخطط** — زر الإغلاق ظاهر دائمًا بسطح سليم، وEscape يحترم النوافذ المتراكبة، وخطتا Pro/Team مختومان بوضوح: "غير مفعّل حالياً · Currently not active".
  Plans screen — close button always visible, Escape respects stacked modals, Pro/Team stamped "Currently not active".
- **المظهر قسم كامل الأهلية** — الثيمة واللغة انتقلا إليه مع شريط معاينة حي لمتغيرات CSS وزر استعادة الافتراضيات وعناوين ثنائية اللغة؛ وشرائط الجلسات الأخيرة ومفتاح أنواع الملفات صارت RTL-آمنة.
  Appearance settings are first-class (live CSS-var preview, reset-to-defaults, bilingual) — plus RTL-safe session rows and file-type legend.

---

## قدرات جديدة / New capabilities

- **عدة تصميم WebCraft مرفقة مع التطبيق** — `dist/webcraft/design-system.css` (أكثر من 900 سطر): أزواج fg/bg دلالية يُضمن تباينها بنيويًا، 126 صنف مكون، فاتح+داكن، RTL-آمن، WCAG AA — والوكيل يبدأ منها.
  WebCraft design-system kit ships in-app — semantic fg/bg token pairs, 126 component classes, light+dark, RTL-safe, WCAG AA; the agent starts from it.
- **أداة `ui_quality_check`** — فحص بصري حتمي بنافذة خفية على 390/820/1366px: يسمّي عناصر الفيض الأفقي، ويكشف التباين المنخفض (<3:1)، والنص الأصغر من 12px، وغياب viewport/lang/title/alt، والأزرار بلا تسمية، وأخطاء الكونسول.
  New `ui_quality_check` tool — deterministic probe at 390/820/1366px reporting overflow offenders, low contrast, tiny text, missing metadata, unlabelled controls, console errors.
- **المحرك يفرض الفحص بنفسه** — بعد أي تشغيل كتب ملفات واجهة يُجرى `ui_quality_check` مرة واحدة وتُعاد الإخفاقات لجولة إصلاح — يعمل مع كل المزودين بلا أي حكم من النموذج.
  The engine auto-runs the probe after any UI-writing run and feeds failures back for a fix round — works with every provider, zero model judgment.
- **أداة `image_generate`** — توليد صور حقيقي من نص بأي لغة (بما فيها العربية) عبر نقطة نهاية مسموَح بها بلا مفتاح، تُكتب داخل جدار الكتابة: آمنة من SSRF، بحد 12MB، ونوع المحتوى مُتحقق منه.
  New `image_generate` tool — real text-to-image in any language (Arabic included) via a keyless allow-listed endpoint, written inside the write-wall (SSRF-safe, 12MB cap, content-type verified).
- **قالب web-dashboard** — رسوم canvas وجدول قابل للفرز وشريط جانبي متجاوب، بملف واحد وبلا أي تبعيات.
  New web-dashboard template — canvas charts, sortable table, responsive sidebar; single file, zero dependencies.
- **قالب web-portfolio** — معرض masonry ونموذج تواصل مع تحقق، بملف واحد وبلا أي تبعيات.
  New web-portfolio template — masonry gallery and a validated contact form; single file, zero dependencies.
- **قالب static-site ترقّى** — صفحة هبوط فاخرة كاملة: مبدّل سمة، ظهور بالتمرير، وجافاسكربت يعمل فعلًا.
  static-site upgraded to a full premium landing page — theme toggle, scroll-reveal, working JS.
- **بروتوكول web-craft أُعيد كتابته** — العدة أولًا، وقوانين تصميم صارمة (5 ألوان، خطّان، أزواج رموز فقط)، وقواعد ضد الطابع الرخيص.
  Web-craft protocol rewritten — kit-first, hard design laws (5 colors, 2 fonts, token pairs only), anti-slop rules.
- **موجز تصميم قبل الكود** — الطلب الغامض يُترجم أولًا إلى موجز تصميم مكتوب قبل أي سطر برمجي.
  Design-brief-before-code — vague requests get a written design brief before any code.
- **إرشاد الوكيل محدَّث** — القوالب صارت 10، و`tests/scaffold.e2e.cjs` حُدّث ليغطيها.
  Agent guidance updated — templates=10, with `tests/scaffold.e2e.cjs` updated to match.
