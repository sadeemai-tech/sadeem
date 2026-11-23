# OpenCode — Reverse-Engineering Notes (SADEEM research agent)

> تقرير بحثي داخلي — يُقرأ فقط. كُتب بواسطة وكيل أبحاث القدرات بتاريخ 2026-11-18.
> كل ما أدناه مُستخلص من مصادر عامة (وثائق + مستودع GitHub). ما لم أتحقق منه مباشرةً
> وُسم بـ "استنتاج/غير مؤكد". **لم أختلق أي برومت أو آلية.**

---

## English summary (for reviewers)

OpenCode v2 (`anomalyco/opencode`, branch `dev`) is an open-source coding agent available as
TUI, desktop and web. I read its public docs and several raw source files. The single most
important finding: **its base system prompt is tiny (≈756 bytes)** — philosophy is
"small stable prompt + behavior pushed into tool descriptions, per-agent config, AGENTS.md,
skills and permissions", the opposite of SADEEM's large prescriptive prompt. The agent loop
(`session/runner/step.ts`) streams provider events, executes each tool call in its own fiber
with cooperative cancellation, snapshots files before/after, and handles retry/compaction/
output-limit as typed outcomes. Permissions are ordered `allow/ask/deny` rules, last match
wins, any deny denies, with a shell scanner that checks every extracted subcommand. A hard
`steps` limit disables tools on the final step and demands a text-only summary. Code Mode
(`execute`) runs JS that calls other tools in parallel to keep intermediate results out of
model context. Ideas worth adopting are mostly **already present** in SADEEM; the genuinely
new ones are: tool-guidance injection keyed to the advertised toolset, the shell-subcommand
scanner, the hard "final step = tools off, summarize" rule, and cache-warming. Most of
OpenCode's server/location/daemon/MDM/Console machinery is **not applicable** to a
local-first Electron app.

---

## 1. ما هي المصادر التي تحققتُ منها فعلاً (Sources verified)

| المصدر | الرابط | ماذا وجدتُ فيه |
| --- | --- | --- |
| الوثائق الرئيسية | https://opencode.ai/docs/ | تعريف، تثبيت، CLI/Desktop/Web |
| مستودع GitHub | https://github.com/anomalyco/opencode (`dev`) | الشيفرة المصدرية الحقيقية |
| README | https://raw.githubusercontent.com/anomalyco/opencode/dev/README.md | الوكلاء build/plan/general/explore |
| **البرومت الداخلي الأساسي** | https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/runner/prompt/system.txt | النص الكامل للبرومت (756 بايت) |
| مُركّب البرومت | https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/system-prompt.ts | حقن `${OPENCODE_TOOL_GUIDANCE}` حسب الأدوات المتاحة |
| حلقة الوكيل (step) | https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/runner/step.ts | كيفية تنفيذ الأدوات والإلغاء والـ retry |
| حدّ الخطوات | https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/runner/max-steps.ts | `MAX_STEPS_PROMPT` — نهاية بدون أدوات |
| وثائق الوكلاء | https://opencode.ai/docs/agents/ | الأنماط، الصلاحيات، `system`، `steps`، الوكلاء المخفيون |
| وثائق الصلاحيات | https://opencode.ai/docs/permissions/ | قواعد allow/ask/deny، الماسح، الموافقات |
| وثائق الأدوات | https://opencode.ai/docs/tools/ | الأدوات، Code Mode، المتصفح، MCP |
| وثائق الإعداد | https://opencode.ai/docs/config/ | compaction، warming، skills، instructions، refs |

> ملاحظة منهجية: `websearch` أعاد HTTP 402 في هذه البيئة، لذلك استخدمتُ `webfetch`
> مباشرة على `raw.githubusercontent.com` ووثائق opencode.ai. هذا مذكور لأمانة البحث.

---

## 2. البرومت الداخلي كما هو فعلاً (مقتبس حرفيًا من system.txt)

```
You are an AI agent running in OpenCode, a coding agent harness. Help the user accomplish their goals using the tools you have available.

# Harness
- Responses are rendered as GitHub-flavored Markdown.
- <system-reminder> blocks are harness instructions, not user-authored content. Read and follow them.
- Prefer parallelizing independent tool calls.
${OPENCODE_TOOL_GUIDANCE}

# Communication
- Use clear file paths when referring to files.
- Keep responses clear and concise, and avoid unnecessary technical jargon.

# Working in codebases
- Keep changes consistent with the structure, naming, style, and patterns of the surrounding code.
- Treat unfamiliar files or changes as potential user work and investigate before deleting or overwriting them.
```

**الاستنتاج الحاسم:** لا يوجد في برومت OpenCode الأساسي أي "capability contract"، ولا
قواعد عربية، ولا أدلة أدوات ضخمة، ولا بروتوكولات تصحيح/تخطيط. كل ذلك خارج البرومت:
- `system-prompt.ts` يستبدل `${OPENCODE_TOOL_GUIDANCE}` بأسطر قصيرة **حسب الأدوات المتاحة فقط**
  (إذا وُجدت `shell` يضيف تحذير "لا تربط أوامر بـ ;"، وإذا وُجدت `edit` يشرح `oldString`).
- وكلاء `build`/`plan` يضيفون نصوص `system` خاصة بهم + صلاحيات (انظر agents docs).
- `AGENTS.md` / instructions / skills تُحقن من مساحة العمل.
- أدواتهم تحمل أوصافًا مفصّلة (tools docs) — النموذج يتعلم السلوك من وصف الأداة لا من البرومت.

هذا تصميم مقصود: برومت صغير ثابت ⇒ **prompt cache hits أعلى** وقابلية أفضل للنماذج،
لكنه يعتمد على نماذج قوية نسبيًا. SADEEM اختار العكس: برومت غني جدًا (900 سطر) يوجّه
النماذج الضعيفة/المحلية بقوة. لا يوجد "فائز مطلق" — كل منهما مقايضة (trade-off).

---

## 3. حلقة الوكيل (Agent loop) — ما يفعله داخليًا

من `session/runner/step.ts` (مُتحقَّق منه):
1. **Streaming:** `llm.stream(...)` تُقرأ حدثًا بحدث عبر `Stream.runForEach`.
2. **أدوات متوازية:** كل `tool-call` يُنفَّذ في *fiber* مستقل (`Effect.forkScoped`) — أي أن
   أدوات متعددة من نفس الدفعة تعمل بالتوازي فعليًا. ترتيب النتائج محفوظ لكل مصدر.
3. **إلغاء تعاوني:** زر الإيقاف يستدعي `cancel.trigger()` للأدوات التي تدعم الإلغاء، ثم
   يقاطع البقية بعد مهلة `COOPERATIVE_STOP = "5 seconds"`. الإلغاء لا يقطع أحداث النهاية.
4. **Snapshot قبل/بعد:** `snapshots.capture()` قبل تنفيذ الأدوات المحلية ومرة بعدها؛
   الفرق (`files`) يُرسل مع حدث نهاية الخطوة (`SessionEvent.Step.Ended`).
5. **Outcomes مُنظّمة:** `Completed | Retry | RecoverFull | Compacted | OutputLimit` —
   أي أن الـ retry والـ compaction والوصول لحدّ الإخراج حالات مُعرّفة صريحًا لا فوضى.
6. **حماية من الإخراج الناقص:** أي أداة بلا نتيجة (`tool.result-missing`) تُفشَل صراحةً؛
   finish reason `unknown` يُعتبر `InvalidProviderOutputError`.
7. **الاستخدام/التكلفة:** `cacheReadInputTokens` و`cacheCreationInputTokens` يُسجَّلان
   في الـ span — يؤكد أن الـ prompt cache جزء من تصميمهم.

من `max-steps.ts` (مُتحقَّق منه): عند بلوغ `steps`، يُرسل برومت `MAX_STEPS_PROMPT` صارم:
> "Tools are disabled until next user input… MUST provide a text response summarizing work
> done so far … Statement that maximum steps … Summary of what has been accomplished …
> List of any remaining tasks … Recommendations … Any attempt to use tools is a critical violation."

هذه "نقطة تلخيص إجبارية بدون أدوات" — قريبة جدًا من فكرة الـ self-critique التي طلبها صاحب
المنصة، لكنها عند OpenCode تُشغَّل **فقط** عند انتهاء الميزانية، لا بعد كل مهمة.

---

## 4. نموذج الصلاحيات (Permissions) — مُتحقَّق من وثائق https://opencode.ai/docs/permissions/

- قواعد مُرتّبة `{action, resource, effect}` مع `effect ∈ {allow, ask, deny}`.
- **آخر قاعدة مطابقة تفوز** (لذلك تُوضع القواعد العامة أولًا والاستثناءات بعدها).
- عملية تمسّ عدة موارد (مثل patch لملفات متعددة): **أي `deny` يمنع**، وإلا أي `ask` يسأل،
  وإلا يُسمح. عدم وجود قاعدة مطابقة ⇒ `ask`.
- أنواع Actions: `read, edit, glob, grep, shell, subagent, skill, question, webfetch,
  websearch, external_directory, execute, <server>_<tool>`.
- **ماسح الصدفة (shell scanner):** يحلّل Bash/Zsh/sh/PowerShell ويستخرج كل أمر فرعي
  (`subcommand`) + أهداف `cd`، ويفحص الصلاحيات لكل واحد على حدة. صيغة خاطئة/تقييم ديناميكي
  غير قابل للتحليل ⇒ خطأ ماسح بدل التنفيذ الأعمى. تحذيرهم الصريح: shell يعمل بصلاحية
  المستخدم الحقيقية، لذا يفضّلون allowlist ضيّقة على أنماط "تتعرف على كل خطر".
- `external_directory`: المسارات خارج مساحة العمل تُفحص؛ الافتراضي يسمحها، ويمكن جعلها `ask`.
- **الموافقات:** `Allow once / Allow always / Reject`. "Allow always" يحفظ نمطًا (مثلاً
  `shell: git status * → allow`) على مستوى المشروع ولا يستطيع تجاوز `deny` صريح.
- **Policies** (من https://opencode.ai/docs/config/ و `/policies`): تُطبَّق بعد القواعد
  والموافقات، وتستطيع تحويل `allow/ask` إلى `deny` فقط — لا تمنح صلاحية أبدًا. إدارة مركزية.

السياسة الافتراضية لكل وكيل: `allow *` ثم `ask` لقراءة `*.env` و`*.env.*` ثم `allow`
لـ `*.env.example`. وكلاء الشحن يضيفون: `plan` يمنع التعديلات إلا تحت `~/.opencode/plan`،
`general` يمنع الأسئلة وتشغيل subagents، `explore` يسمح بالقراءة/البحث/الويب فقط،
`title`/`summary` يمنعان كل شيء، `compaction` يحتفظ بالأساس.

---

## 5. الوكلاء (Agents) — مُتحقَّق من https://opencode.ai/docs/agents/

- وكيل = system prompt + model + permissions + عرض. يُعرَّف بملف Markdown في
  `.opencode/agents/<name>.md` أو `~/.config/opencode/agents/`.
- `mode`: `primary` | `subagent` | `all`. الـ subagents تعمل دائمًا في الخلفية بسياق جديد،
  ويستقبل الأب تقريرًا عند الخمول وبعد كل جولة لاحقة.
- **الوكلاء المخفيون للصيانة:** `compaction`, `title`, `summary` — لا يمكن اختيارهم،
  ويؤدون تلخيص المحادثة/العنوان/الضغط. لا يوجد `scout` في v2.
- حقل `system` **يستبدل** برومت المزوّد الأساسي للوكيل — لكن تعليمات المشروع/المهارات
  تُضاف بعده. تحذير الوثائق: لا تستخدم حقول v1 القديمة (`temperature`, `tools`, ...).
- `steps` حدّ صحيح للخطوات؛ `hidden` يخفي الوكيل (ليس إجراءً أمنيًا)؛ `disabled` يُزيل وكلاء الشحن.

---

## 6. أدوات مثيرة للاهتمام – Code Mode — مُتحقَّق من https://opencode.ai/docs/tools/

- الأدوات الأساسية: `read, glob, grep, edit, write, patch, shell, webfetch, websearch,
  question, skill, subagent, execute, browser_*, opencode_*`.
- **`execute` (Code Mode):** شبيه بأداتنا `execute` — يشغّل JavaScript في بيئة مقيّدة
  (بلا imports/fs/timers) لاستدعاء ودمج أدوات أخرى **بالتوازي** وإبقاء النتائج الوسيطة
  خارج سياق النموذج. منع `execute` يُسقط Code Mode وتُعرض الأدوات مباشرة. هذه أقوى
  فكرة "توفير سياق" عندهم.
- الأدوات المُعلَنة تُخفى أحيانًا خلف Code Mode (MCP افتراضيًا عبر `execute`) — وهذا يشرح
  لماذا برومتهم الأساسي صغير: النموذج لا يحتاج قائمة أدوات ضخمة في البرومت.
- `patch` متاح فقط لنماذج GPT مدعومة؛ غيرها يحصل على `edit/write`.

---

## 7. أفكار تستحق التبنّي في SADEEM (وما تبيّن أنه موجود عندنا فعلاً)

| الفكرة في OpenCode | الحالة في SADEEM | التوصية |
| --- | --- | --- |
| برومت ثابت + حقن إرشادات حسب الأدوات | موجود جزئيًا: أقسام ثابتة + أقسام مشروطة (DNA/Playbook/MCP) | ✅ جيد؛ أضفنا قسم Vibe Coder ثابت الكلمات |
| وكيل Plan/Read-only بصلاحيات صلبة | موجود: `TASK_MODE_SPECS` + gate | ✅ لا تغيير |
| قواعد allow/ask/deny مرتّبة + "أي deny يمنع" | موجود: `.surnia/policy.json` + gate | ✅ لا تغيير |
| "Allow always" محفوظ لا يتجاوز deny | موجود: `alwaysRules` | ✅ لا تغيير |
| ماسح أوامر الصدفة لكل أمر فرعي | موجود تقريبيًا: `isMutatingCommand` + terminalGuard | ⚠️ فكرة للتحسين لاحقًا (ليست في نطاق هذه المهمة) |
| حدّ خطوات ⇒ تلخيص إجباري بلا أدوات | موجود تقريبًا: `maxedOut` + `[Stopped…]` | ألهمتنا لنقطة self-critique (لا نُكرِّر: نُوسّع الموجود) |
| Code Mode لتقليل السياق | موجود: أداة `execute` + تجميع القراءات | ✅ لا تغيير |
| Compaction + prompt cache | موجود: compaction + ثبات الكلمات | ✅ لا تغيير |
| Skills / AGENTS.md | موجود: قواعد الملفات + مهارات | ✅ لا تغيير |
| **Cache warming قبل انتهاء TTL** | غير موجود | 💡 فكرة جديدة تستحق دراسة منفصلة (تتطلب جدولة/خلفية) |

---

## 8. ما **لا ينطبق** على تطبيق Electron محليّ-أول (local-first)

- **بنية الخادم/العميل، "locations"، process daemon، WebSocket transports، `opencode pair`،
  صور Docker، ترخيص Console/Go**: كلها خاصة بمنتج OpenCode السحابي/متعدد المستخدمين.
  SADEEM يعمل بمفتاح المستخدم محليًا и أدواته تلمس الجهاز مباشرة — لا داعي لها.
- **Managed MDM / policies مركزية / directives مؤسسية**: غير ذات صلة بتطبيق مستخدم واحد،
  ما لم نضيف وضع مؤسسة لاحقًا.
- **حزمة Bun + Effect-TS + Drizzle**: لا يمكن نسخ الشيفرة (Stack مختلف تمامًا) — نقلنا الأفكار فقط.
- **Native provider compaction / cache-warming endpoints**: تعتمد على دعم المزوّد؛ مفيدة لكنها
  ليست "ترقية داخلية للذكاء" بالمعنى المطلوب هنا.
- **Browser namespace المرتبط بتطبيق سطح المكتب**: عندنا بالفعل أدوات browser_* الخاصة بنا.

---

## 9. حدود البحث (Honest limitations)

- لم أصل إلى نص `system` لكلاء `build`/`plan` المدمجين في v2 (يبدو أنه مُولَّد/مُدمج في
  `config.ts`/`@opencode/schema` لا ملف نصي مستقل). الوثائق تؤكد أن `system` قابل للاستبدال
  وأن الوكلاء المدمجين هكذا، لكن **لم أتحقق من نصهم حرفيًا** — لم أستخدمه كدليل.
- `websearch` كان معطوبًا (402)، فاعتمدت على `webfetch`؛ هناك صفحات (مثل `/plugins`, `/policies`)
  لم أفتحها بالكامل، واكتفيت بما ذُكر عنها في `/config` و`/permissions`.
- هذا **reverse-engineering من مصادر عامة**، لا من عقد أو اتفاقية؛ قد تتغير التفاصيل في إصدار
  لاحق. جميع الروابط أعلاه تشير إلى فرع `dev` وقت كتابة التقرير.
