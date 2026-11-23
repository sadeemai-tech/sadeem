# Cursor — Reverse-Engineering Notes (SADEEM research agent)

> تقرير بحثي داخلي — كُتب بواسطة وكيل الأبحاث بتاريخ 2026-11-19، استجابةً لطلب المؤسس:
> «ما جبت سيرة كورسير، ابحث عنه وقم بعمل هندسة عكسية له، لأنك ستجد إبداعات جميلة».
> كل ما أدناه مُستخلص من **وثائق Cursor الرسمية العامة** ومنتدى المستخدمين الرسمي. ما لم
> أتحقق منه مباشرةً وُسم صراحةً «غير مُتحقَّق منه». **لم أختلق أي برومت أو آلية داخلية.**

---

## 1. English summary (for reviewers)

Cursor (now part of SpaceX, per its own site) is an IDE-native coding agent with a large
surface: @-mentions for attaching exact context, a four-kind rules system (`.cursor/rules/*.mdc`,
user, team, `AGENTS.md`) with `alwaysApply`/`globs`/`description` frontmatter, Plan Mode,
local **checkpoints** that are explicitly *not* Git, queued messages and "steer at the next
tool call", subagents with context isolation (built-in Explore/Browser exist specifically because
search/DOM output bloats the main context), a structured handoff pattern between planner →
implementer → verifier, Bugbot PR review with repo rules and "dry run", Privacy Mode (no training
on code), and cloud/background agents. Tab autocomplete does multi-line and cross-file edits with
"jump-in-file". Composer 2 is a trained model whose RL runs *inside the real Cursor harness*
against a benchmark built from real engineering sessions.

The genuinely portable ideas for a local-first Electron app are: **explicit context attachment**,
**rules with scoped activation**, **structured subagent handoffs**, **context-budget visibility**,
and **a clean "what changed" digest**. Checkpoints and steer-at-tool-boundary are valuable but
require engine-level changes outside this subagent's ownership; the public forum contains a real
2025 bug report showing checkpoint restore once destroyed change history — a warning to make any
future restore *itself undoable*. Cloud agents, trained models, PR bots and telemetry are not
applicable to SADEEM's local-first, single-user design.

I implemented three tested helpers in `electron/agent/cursorIdeas.ts`:
`resolveContextMentions`, `digestFileChanges`, and `formatAgentHandoff`/`parseAgentHandoff`.

---

## 2. المصادر التي تحققتُ منها فعلاً (verified sources)

| المصدر | الرابط | ما وجدتُه فعلاً |
| --- | --- | --- |
| صفحة المنتج | https://cursor.com/features | وكيل IDE، وكلاء سحابيون متوازون، CLI/Slack/GitHub، «autonomy slider» (اقتباس Karpathy) |
| فهرس الوثائق | https://cursor.com/docs/llms.txt | خريطة كل صفحات الوثائق (استخدمتها للتنقل؛ المسارات القديمة مثل `/context/@-symbols/*` لم تعد موجودة) |
| @ mentions | https://cursor.com/docs/agent/prompting و https://cursor.com/help/customization/context | ملفات/مجلدات/terminal/chats/git diffs/browser؛ نصيحة: إن لم تعرف الملفات، اترك الوكيل يبحث |
| القواعد | https://cursor.com/docs/rules | `.cursor/rules/*.mdc` بـ frontmatter، `AGENTS.md` متداخل، أسبقية Team→Project→User، «أقل من 500 سطر»، الإشارة للملفات بـ `@` دون تضمين محتواها |
| الوكلاء | https://cursor.com/docs/agent/overview | أدوات، checkpoints محلية ليست Git، queued messages، steer عند أداة لاحقة، side chats، conversation search، `/goal` |
| Plan Mode | https://cursor.com/docs/agent/plan-mode | أسئلة توضيح → بحث → خطة قابلة للتحرير → بناء؛ «الرجوع للخطة أفضل من ترقيع وكيل ضائع» |
| الوكلاء الفرعيون | https://cursor.com/docs/subagents | عزل السياق، foreground/background، Explore وBrowser وُجدا بسبب ضجيج المخرجات، handoff منظّم بين planner/implementer/verifier، استئناف بمعرّف، عزل worktree |
| Tab | https://cursor.com/help/ai-features/tab | تعدد الأسطر، استيراد ناقص، تعديلات عبر ملفات، قفزة داخل الملف، إيقاف مؤقت/حسب الامتداد |
| Bugbot | https://cursor.com/docs/bugbot | مراجعة PR، تشغيل عند ذكر `cursor review`، مراجعة تزايدية، `.cursor/config/bugbot.yaml`، `.cursor/BUGBOT.md` متداخل، تجنّب ملفات credentials، autofix عبر Cloud Agent |
| الخصوصية | https://cursor.com/help/security-and-privacy/privacy | Privacy Mode = عدم استخدام الكود للتدريب؛ استثناءات ZDR؛ فرض إداري للمؤسسات |
| Composer 2 | https://cursor.com/blog/composer-2-technical-report | تدريب مستمر + RL داخل بيئة Cursor الحقيقية، CursorBench من جلسات هندسية فعلية، تغييرات مئات الأسطر عبر ملفات متعددة |
| منتدى Cursor | https://forum.cursor.com/t/restore-checkpoint-permanently-destroys-change-history/129652 | بلاغ مستخدم (أغسطس 2025): استعادة checkpoint أتلفت سجل التغييرات؛ رد الموظف «تحققتُ وهو يعمل بشكل صحيح» ثم «سنحقّق»؛ أُغلق سبتمبر 2025 |

> ملاحظة منهجية: `websearch` في هذه البيئة إما 402 أو يعيد نتائج عامة غير موثوقة، لذلك
> اعتمدتُ على `webfetch` مباشرةً على `cursor.com` و`api.github.com`. بحث GitHub عن
> `repo:getcursor/cursor` أعاد **HTTP 422** (لا يوجد مستودعissues عام بهذا الاسم)؛
> قناة الملاحظات العامة التي تشير إليها الوثائق هي `forum.cursor.com`.

---

## 3. Findings — ما هي الفكرة، لماذا تنجح، وهل تناسب Electron محلي؟

### 3.1 @ mentions — إرفاق سياق صريح
عند كتابة `@` تظهر ملفات ومجلدات وسياقات أخرى؛ `@auth.ts`، `@src/components/`،
`@Terminals`، `@Chats`، `@Commit (Diff of Working State)`، `@Browser`. الوثائق تقول صراحةً:
استخدمها **عندما تعرف** الملفات ذات الصلة، واترك البحث للوكيل إن لم تكن تعرف.
**لماذا تنجح:** تقلّل التخمين وتجعل السياق حتميًا بدل أن يضيع في نافذة طويلة.
**التطبيق في SADEEM:** ممكن تمامًا محليًا: لدينا بالفعل `CodeIndex` (رموز + مسارات) ومسارات
ملفات حقيقية. نفّذتُ `resolveContextMentions` كدالة نقية تقابل `@file`/`@folder`/`@symbol`
بالمسارات المتاحة، وترفض الغموض بدل التخمين، وتمنع خروج المسار من جذر مساحة العمل.

### 3.2 القواعد (Rules) — تعليمات دائمة بمفعّل نطاقي
أربعة أنواع: مشروع (`.cursor/rules/*.mdc`)، مستخدم، فريق، و`AGENTS.md`. حقول
`alwaysApply` / `description` / `globs` تحدد متى تُحقن القاعدة. قاعدة `.md` داخل
`.cursor/rules` **تُتجاهل** (لا frontmatter). الترتيب: Team → Project → User. نصيحة:
اجعل القاعدة قصيرة (<500 سطر) وأشر إلى الملفات بـ `@` دون نسخ محتواها.
**لماذا تنجح:** القواعد تُحقن في بداية السياق فتوجّه كل جولة بتكلفة منخفضة، والتنشيط
النطاقي يمنع تضخيم البرومت. **التطبيق:** SADEEM لديه بالفعل قواعد ملفات/مهارات؛
التوصية هي توحيد تنشيط `globs` لا نسخ نظام Cursor (انظر الجدول).

### 3.3 Checkpoints — لقطات محلية ليست Git
تنشأ تلقائيًا قبل تغييرات جوهرية؛ تستطيع معاينة الملفات عند نقطة سابقة واستعادتها.
الوثائق حازمة: «restore يُرجع الملفات فقط، لا يحذف الرسائل»، و«محفوظة محليًا ومنفصلة عن
Git؛ استخدم Git للتحكم الدائم بالإصدارات».
**لماذا تنجح:** تشجّع الاستكشاف الآمن دون إجبار المستخدم على Git.
**درس من المنتدى:** البلاغ المذكور أعلاه يوضح خطر جعل الاستعادة مدمرّة؛ أي تطبيق لاحق
يجب أن يجعل **الاستعادة نفسها قابلة للتراجع** ويعرض معاينة (dry-run).
**التطبيق:** يتطلب تعديل `engine.ts`/`store.ts` — خارج نطاق هذه المهمة. **skip الآن، احتفظ بالدرس.**

### 3.4 Queued messages و Steer at next tool call
أثناء عمل الوكيل: Enter يُضيف رسالة لطابور، Cmd+Enter يُرسل فورًا، و«Send now» تُسلَّم
عند **أداة لاحقة** لا في منتصف إجراء جارٍ. **لماذا تنجح:** لا يضيع عمل قيد التنفيذ،
ويبقى المستخدم قادرًا على تصحيح المسار. **التطبيق:** أداة `execute` المتوازي وآليات
الإلغاء في SADEEM قريبة منها؛ إضافة «تسليم عند حدّ أداة» تحتاج محركًا — **adapt لاحقًا**.

### 3.5 الوكلاء الفرعيون و«بطاقة التسليم»
الوكلاء يبدأون بسياق نظيف، والأب يمرّر كل ما يلزم في البرومت. الوكلاء المدمجون
`Explore`/`Browser` وُجدوا — بحسب الوثائق — لأن مخرجات البحث/DOM تُضخّم السياق،
ولأن نموذجًا أسرع يكفي للتشغيل المتوازي. نمط «Orchestrator»: planner → implementer →
verifier، و«كل تسليم يحمل مخرجات منظّمة حتى يكون للوكيل التالي سياق واضح».
هناك أيضًا استئناف بمعرّف، وتقييد تعشيش، وعزل worktree عند التعديل المتوازي.
**لماذا تنجح:** عزل الضجيج + تخصص النموذج + فحص مستقل يرفع الموثوقية بتكلفة سياق أقل.
**التطبيق:** SADEEM لديه `subagents.ts` (ledger)، `subagentRunner.ts`، و`review.ts`.
نفّذتُ `formatAgentHandoff`/`parseAgentHandoff` كبطاقة نصية قابلة للقراءة والتحليل
(role/status/summary/files/verified/unverified/tests) — ** adapt مباشر**.

### 3.6 Context usage ring — شفافية الميزانية
شريط يعرض توزيع السياق: System prompt / Tools / Rules / Skills / MCP / Subagents /
Summarized conversation / Conversation. **لماذا تنجح:** المستخدم يفهم لماذا امتلأ السياق
ومتى يُضغط. **التطبيق:** واجهةRenderer خارج نطاقي؛ الفكرة قابلة للـ adapt عبر تقرير
نصي منفصل في eventual step.

### 3.7 Bugbot — مراجعة PR كمنتج مستقل
مراجعة تلقائية عند كل تحديث PR أو بأمر `cursor review`، مراجعة تزايدية افتراضيًا،
قواعد `.cursor/BUGBOT.md` متداخلة و`.cursor/config/bugbot.yaml` من الفرع الأساسي فقط،
وضع `dryRun` عبر API، وتجنّب قراءة ملفات مشابهة لملفات credentials.
**لماذا تنجح:** الفصل بين «من كتب الكود» و«من يحقّقه»، وتثبيت القواعد في المستودع.
**التطبيق:** عندنا `review.ts` و`docs`/`proof`/`verification`. **adapt جزئي** (فكرة
الفحص المستقل موجودة؛ الـ API/SCM غير ذي صلة بمستخدم محلي).

### 3.8 Privacy Mode
«كودك لا يُستخدم للتدريب»، مُفعّل افتراضيًا للفرق، وقابل للفرض إداريًا؛ استثناءات:
مفاتيح API الخاصة بالمستخدم وبعض النماذج التي تتطلب احتفاظًا بالبيانات.
**التطبيق:** SADEEM محلي-أول بمفتاح المستخدم؛ نقل الفكرة يعني **توضيح تدفق البيانات
في الوثائق** لا بناء مفتاح تبديل. **adapt(doc-only)**.

### 3.9 Tab autocomplete / Composer 2 / Cloud agents
- Tab: إكمال متعدد الأسطر، استيراد ناقص، تعديل عبر ملفات، وقفزة «jump-in-file».
- Composer 2:RL داخل بيئة حقيقية + معيار من جلسات فعلية (تغييرات مئات الأسطر عبر ملفات).
- Cloud/background agents: وكلاء على أجهزة/VLAN خاصة بالمنتج (من صفحة المنتج وفهرس الوثائق).
**التطبيق:** نموذج Tab/Composer يحتاج تدريبًا وبنية تحتية لا تملكها هنا؛
الوكلاء السحابيون عكس فلسفة SADEEM المحلية. **skip مع احترام الفكرة.**

---

## 4. جدول القرار: adopt / adapt / skip

| الفكرة (مُتحقَّق منها) | القرار | السبب |
| --- | --- | --- |
| @ mentions للملفات/المجلدات | **adapt ✅ نُفِّذ** | بياناتنا الحالية (قائمة ملفات + CodeIndex) تكفي؛ حلّ بلا fs ولا Electron |
| @symbol عبر LSP | **adapt (partially) ✅ نُفِّذ** | وثائق 2026 لا تذكر `@symbol`؛ أصلحنا الفكرة بمطابقة رموز `CodeIndex.findDefinitions`، وسُمّيت «غير مؤكدة رسميًا» في النص |
| تذكير «اترك البحث إن لم تعرف الملف» | **adopt (doc/concept)** | موجود فعلاً كأدوات بحث في SADEEM؛ لا تغيير كودي |
| قواعد `globs`/`alwaysApply`/`description` | **adapt** | موجود تقريبيًا؛ توحيد النمط أهم من نسخ `.mdc` |
| `AGENTS.md` متداخل | **skip الآن** | قواعد الملفات/Hooks تغطي الغرض؛ إضافة شكل جديد بلا مستهلكين = ضجيج |
| Checkpoints محلية + معاينة + «استعادة قابلة للتراجع» | **skip الآن (درس محفوظ)** | يتطلب engine/store؛ بلاغ المنتدى يفرض تصميمًا حذرًا |
| Steer عند حدّ أداة / طابور رسائل | **adapt لاحقًا** | قريب من إلغائنا المتعاون لكنه يحتاج محركًا |
| Handoff منظّم بين الوكلاء | **adapt ✅ نُفِّذ** | بطاقة قابلة للتحليل لسجل الوكلاء الموجود |
| عزل السياق للوكلاء (Explore/Browser) | **adopt (موجود)** | `subagents.ts` + `review.ts` يغطيان الفكرة |
| تصنيف مخرجات السياق (ring) | **adapt لاحقًا** | renderer خارج نطاق هذا الوكيل |
| Bugbot: فحص مستقل + قواعد مستودع + dryRun | **adapt جزئي** | الفحص موجود (`review.ts`)؛ SCM/API غير مناسب لمستخدم محلي |
| Privacy Mode كوثيقة سلوك | **adapt (doc-only)** | SADEEM محلي-أول أصلًا؛ الشفافية مطلوبة لا المفتاح |
| Tab AFRE (كما ورد في طلب المؤسس) | **skip / غير مُتحقَّق** | لم أجد مصطلح «AFRE» في أي صفحة رسمية جلبتُها؛ لن أنسب معنىً Cursor لم أتحقق منه |
| Composer 2 (نموذج مدرب، CursorBench) | **skip** | تدريب/بنية تحتية؛ لا يمكن نقله إلى تطبيق محلي بلا موارد |
| Cloud/background agents، Autofix، Git at scale | **skip** | عكس local-first؛ يعتمد على خوادم Cursor |

---

## 5. ما نفّذته فعلاً (files + contract)

| الملف | المحتوى |
| --- | --- |
| `electron/agent/cursorIdeas.ts` | `resolveContextMentions` + `renderMentionContext`: @file/@folder/@symbol → مسارات مطلقة داخل جذر العمل، غموض يُبلَّغ لا يُخمَّن، حدود صريحة، لا يقرأ القرص. `digestFileChanges`: يجمع نتائج الأدوات حسب الملف، يعدّ hunks/+/-، يزيل ANSI، يلتزم بسقوف ويُنتج Markdown نظيفًا. `formatAgentHandoff`/`parseAgentHandoff`: بطاقة تسليم حتمية مع رفض صريح للمدخلات المكسورة. كل الدوال defensive وتعمل على بيانات حقيقية الشكل (`SymbolHit`، `ToolOutcome`، `SubagentRecord`). |
| `tests/v1115-cursor-ideas.test.mjs` | 6 اختبارات offline: رموز حقيقية الشكل، غموض/هروب مسار/سقوف، diff متعدد الملفات مع ANSI، فشل صادق على مدخلات خاطئة، جولة ذهاب/عودة لبطاقة التسليم، رفض بطاقة تالفة. |
| `docs/CURSOR-RE.md` | هذا التقرير. |

> لم أعدّل `engine.ts` أو `prompts.ts` أو `tools.ts` أو `store.ts` أو أي ملف renderer —
> كما هو مطلوب في نطاق المهمة. الدوال متاحة للاستخدام لاحقًا دون تغيير سلوك المحرك الآن.

---

## 6. حدود البحث والتحقق (honest limitations)

**ما لم أتحقق منه:**
- لم أصل إلى أي برومت داخلي أو كود مصدر لـ Cursor (منتج مغلق)؛ كل ما سبق سلوك مُعلن
  أو ملاحظة مستخدمين، لا «هندسة عكسية للشيفرة». مصطلح «AFRE» لم يُعثر عليه.
- آلية توليد Composer للـ diffs متعددة الملفات داخليًا غير معروفة؛ المعرفة المتاحة هي
  ورقة التدريب فقط. «multi-file diff UI» مذكور في صفحات المنتج/الوكلاء لكن تفاصيله لم تُفتح.
- بحث GitHub الموجّه إلى `getcursor/cursor` فشل (422)؛ منتدى Cursor فيه threads كثيرة
  لم أقرأ سوى واحد منها. لا أدّعي إحصاءً أو إجماعًا من المنتدى.
- صفحة قديمة كانت تُعرف بـ `docs.cursor.com/agent/chat/checkpoints` أحالني إليها طرف
  ثالث؛ تحققتُ من Checkpoints عبر `cursor.com/docs/agent/overview` الحالية instead.
- لا توجد مقارنة أداء كمية بين SADEEM وCursor في هذا التقرير؛ لم أجرِّ قياسًا.

**التحقق التقني الذي أجريته فعلاً:**
- `node --test --test-force-exit tests/v1115-cursor-ideas.test.mjs` → **6/6 green**.
- فحص نوع مركّز للملف الجديد (نفس خيارات `tsconfig.node.json`، `--strict`) → **exit 0**.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json` → **يمرّ الآن (exit 0)**.
  ملاحظة زمنية للأمانة: في أول تشغيل لهذا الأمر (قبل كتابة ملفاتي) ظهر خطأ سابق الوجود
  في `electron/agent/budget.ts(121,5)` (`TS2741: Property 'longRun' is missing`)، ثم أُصلح
  خارجيًا أثناء جلسة العمل هذه (السطر 115 صار `Required<Omit<BudgetConfig, 'longRun'>>`).
  لم أعدّل `budget.ts` — فهو خارج نطاق ملكيتي — ولا ظهر أي خطأ TypeScript ناتج عن عملي.
