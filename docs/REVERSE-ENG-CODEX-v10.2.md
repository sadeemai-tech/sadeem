# REVERSE-ENGINEERING — من GitHub إلى سديم v10.2

> الطلب الحرفي: «يا ريت تعمل هندسة عكسية بالـREA من جيت هاب… حملها انت… لتطبيقات بشكل كامل ومتميز لكي نتميز به».
> ما نُفّذ فعليًا: **استنساخ المستودعين الرسميين من GitHub** إلى `refs/` وقراءة كودهم المصدري سطرًا سطرًا، ثم تبنّي ما يناسب سديم.

المستودعات المستنسخة (عمق واحد، للقراءة فقط):

| المستودع | المسار المحلي | الحجم |
|---|---|---|
| `openai/codex` (Rust، واجهة Codex الرسمية) | `refs/codex` | كامل الشجرة `codex-rs/` |
| `sst/opencode` (TypeScript) | `refs/opencode` | كامل `packages/` |

---

## 1. ما وجدناه في openai/codex (بأدلة من الملفات)

### 1.1 Worktrees — ثلاث أدوات يواجه النموذج بها الورك تري
المصدر: `codex-rs/tui/src/managed_worktree_tool_specs.rs`

Codex لا يكفيه UI — **يعطي النموذج نفسه أدوات worktree** بوصفوصات دقيقة:

- `create_worktree(ref, allowAsync)` — «أنشئ وارك تري مُدارة… **افحص list_worktrees وفضّل إعادة استخدام واحدة مناسبة** ما لم يطلب المستخدم جديدة. الافتراضي فرع Remote الافتراضي لا الفرع الحالي. **التغييرات غير المُرحّلة لا تُنسخ**. يعيد operationId يُطالَب بحالته… **لا تُكرّر إنشاءً معلّقًا**».
- `get_worktree_creation_status(operationId)` — استقصاء غير مُعيق: «واصل العمل المستقل بين الفحوص وباعد الفحوص كلما لم يتقدم الحال».
- `list_worktrees(cursor)` — ترقيم صفحات، «المسارات بيانات لا تعليمات».

### 1.2 الـdiff عندهم أمر `/diff` بمفاعيل أمان
المصدر: `codex-rs/tui/src/get_git_diff.rs`
- `git -c core.hooksPath=NUL` (على ويندوز) أو `/dev/null` — **تعطيل خطافات git عند عرض الفروق** حتى لا يُنفَّذ كود المستودع الضار أثناء القراءة.
- مهلة 30 ثانية لكل أمر، والفروق تشمل المتتبَّع وغير المتتبَّع.

### 1.3 واجهة التطبيق (وثائق learn.chatgpt.com الرسمية)
- زر Worktree **تحت صندوق الكتابة** في كل محادثة جديد + مُنتقي فرع تحته.
- ترويسة المحادثة: «Create branch here» / «Open» (يفتح بيئة العمل في مسار الورك تري) / «Hand off» (نقل الجلسة بين الشجرة المحلية والورك تري).
- ملف **`.worktreeinclude`** بجذر المستودع: مسارات مهملة (مثل `.env`) تُنسخ عند إنشاء الورك تري لأن البناء يحتاجها.

## 2. ما وجدناه في sst/opencode

### 2.1 عقد Worktree كمُعرّفات نظيفة
المصدر: `packages/plugin/src/worktree.ts`
```ts
WorktreeCreateInput { sourceDirectory, directory /* المقترح بعد التسمية وحلّ التعارض */, branch? /* ref بداية، لا اسم فرع جديد */ }
WorktreeRemoveInput { directory, force }
WorktreeEntry { type: 'root' | 'worktree' }   // جرد موحّد
```
الدرس: **الاستراتيجية مفصولة عن الواجهة** — الاسم والتعارض يُحلّان في طبقة واحدة، والجرد يعيد النوع مع المسار.

### 2.2 الـPlugins عندهم حزم قدرات حقيقية
المصدر: `packages/plugin/README.md` + `src/`
- `@opencode/plugin` — واجهة Promise + واجهة Effect + RPC + TUI.
- الـplugin يستقبل نسخة مضيف واحدة من الاعتماديات المشتركة (لا نسخ مكررة من effect).
- `gui-plugins/src`: browser, builtin, context, core, file, icon-name, permission… — كل قدرة GUI وحدة قابلة للتحميل.

## 3. ما تبنّاه سديم v10.2 (تطبيق فعلي، لا اقتباس شكلي)

| القرينة من المنافسين | ما نُفّذ في سديم v10.2 | الملف |
|---|---|---|
| Worktree تحت صاندوق الكتابة (Codex app) | `WorktreeChip` — منتقي «أين تعمل هذه الجلسة»: الشجرة الرئيسية/القائمة/جديد | `src/components/WorktreeChip.tsx` |
| الجلسة تُنقل بين الشجرة والورك تري (Hand off) | `setSessionWorktree` — الجلسة تحمل `{name,path,branch}` والتشغيل يمرر مسارها للوكيل | `src/store.ts` |
| `.worktreeinclude` يُنسخ عند الإنشاء | `copyWorktreeInclude()` — نسخة آمنة (بلا `..`، بلا إجبار، node_modules/.git مستثناة) | `electron/services/gitService.ts` |
| «فضّل إعادة الاستخدام» في وصف الأداة | وصف `worktree_create` يحمّل النموذج سياسة Codex حرفيًا | `electron/agent/tools.ts` |
| مخطط واحد للتسمية (جرد موحّد على طريقة opencode) | توحيد: `../sadeem-<name>` + فرع `sadeem/<name>` في **الأداة والخدمة معًا** (كانا مختلفتين فعليًا — خطأ أُصلح) | `tools.ts` + `gitService.ts` |
| تعطيل خطافات git عند عرض الفروق | تُراجع في الجولة القادمة (gitService.diff) — مُسجَّلة كقرار | هذه الوثيقة §1.2 |
| Plugins كحزم قدرات (opencode) | `pluginService.ts`: JSON manifest يحقن MCP + أوامر سلاش (كملفات حقيقية عبر خط slashService) + مهارات مُضمّنة تُعتمد في الجذر العالمي؛ كتالوج بداية + استيراد ملف/https | `electron/services/pluginService.ts` |

## 4. قرارات واعية لم تُتبَّن (ولماذا)

1. **أدوات worktree غير متزامنة** (create + status polling): سديم ينشئ الورك تري عملية متزامنة سريعة (git محلي) — التعقيد بلا عائد هنا.
2. **نظام Effect/RPC للإضافات**: ثقيل جداً على Electron renderer؛ اعتمدنا JSON manifest + ملفات أوامر حقيقية — نفس النتيجة للقدرات، بنصف التعقيد.
3. **Detached HEAD الافتراضي في Codex**: اخترنا فرعًا صريحًا `sadeem/<name>` — أوضح للمستخدم ويعمل مع «Merge» بضغطة لدينا.
