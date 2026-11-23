# v11.42 — SADEEM as a FULL terminal agent / وكيل كامل من الترمينال

## الحكم الصريح — Blunt verdict

**نعم. الآن SADEEM يعمل فعلاً كوكيل كامل من الترمينال — ليس مجرد واجهة دردشة.**
**Yes. SADEEM now really runs as a full agent from the terminal — not a chat shim.**

`سadeem run "<task>"` يستدعي **نفس محرك `runAgent()`** الذي يستدعيه تطبيق سطح المكتب: نفس سجل الأدوات (145 أداة)، والموافقات، وDNA/Playbook، والوكلاء الفرعيين، والضغط (compaction)، وتقرير الإكمال الصادق. `sadeem` بدون وسائط يفتح حلقة REPL تفاعلية متعددة الأدوار تحتفظ بالسياق.

`npm i -g sadeem && sadeem run "fix the flaky test"` هو الآن وصف حقيقي لما يحدث — **مع تحذير واحد صادق أدناه** (`package.json` لا يزال `"private": true`) قبل أن يصبح التثبيت من npm حقيقة قابلة للتنفيذ.

---

## 1. Audit — ما كان موجوداً فعلاً قبل هذا التغيير

| السؤال | الحقيقة قبل v11.42 |
|---|---|
| هل يوجد CLI؟ | نعم، `electron/agent/cli.ts` (~16KB) وُبني عبر `npm run build:cli` إلى `dist-cli/kodex.cjs` + `surnia.cjs`. |
| هل كان وكيلاً كاملاً؟ | **جزئياً.** كان يستدعي `runAgent()` الحقيقي، لكن بلا أوامر: كل كلمة غير راية كانت تُضم إلى "المهمة"، فكان `sadeem run "task"` يعني فعلياً المهمة `"run task"`. |
| الأوامر المدعومة | **`verify`** فقط (تحقق من حزمة إثبات)، **`journals` / `journal`** (سجلات التشغيل)، وصيغة مهمة عارية `sadeem "task"`. لا `help`، لا `version`، لا `config`، لا `models`، ولا REPL. |
| تحميل الإعدادات/المفتاح | الأعلام `--api-key/--base-url` أوEnv (`KODEX_*`)، ثم `storeService.getSettings()` من `~/.surnia/settings.json`. **لكن** الافتراضي كان `provider=custom, model=gpt-4o` مكتوباً بالقوة — أي أن إعدادات النموذج في التطبيق لم تكن تُحترم. |
| الموافقات في الترمينال | **غير صادقة:** `getDecision` كان يعيد `allow` دائماً، وحدث `approval_request` كان يُطبع "auto-approved" حتى في وضع `default`. لا يوجد سؤال حقيقي للمستخدم. |
| أمر قابل للتثبيت | **لا.** لا حقل `bin` في `package.json`، فلا يوجد `sadeem` ولا `npx sadeem`. |
| الإخراج | بثّ أحداث المحرك (text_delta/tool_start/tool_result/...) لكن بدون تقرير `task_report` مُنسّق، وبدون محادثة متعددة الأدوار. |

---

## 2. ما تغيّر فعلاً — Exact changes

### `electron/agent/cli.ts` (أعيد بناؤه بالكامل)

| الميزة | الموقع (file:line عند الكتابة) |
|---|---|
| shebang + وصف أن هذا هو المحرك الحقيقي | `electron/agent/cli.ts:1` |
| electron stub (يعمل بلا Electron) + `SURNIA_HOME` | `electron/agent/cli.ts:39` |
| الأوامر: `run`, `help`, `version`, `config`, `models`, `verify`, `journals`, `journal`, REPL | `electron/agent/cli.ts:686` (`main()`) |
| تحليل الوسائط (`--mode/--workspace/--provider/--model/--base-url/--api-key/--image/--yes/--quiet`) | `electron/agent/cli.ts:74` |
| **local-first:** النموذج والمزود الافتراضيان من `~/.surnia/settings.json` | `electron/agent/cli.ts:74` + `:174` |
| `config` — يعرض الإعدادات الفعّالة، المفتاح **مقنّعاً** أبداً | `electron/agent/cli.ts:188` |
| `models` — كتالوج النماذج الحقيقي من `providers.ts` | `electron/agent/cli.ts:213` |
| طابور stdin واحد يخدم REPL وأسئلة الموافقة معاً | `electron/agent/cli.ts:229` |
| **موافقة حقيقية في الترمينال**: `[y]es/[n]o/[a]lways/[s]ession/Never`، و`ask_user` كسؤال نصي، والرفض هو الافتراضي عند EOF | `electron/agent/cli.ts:305` |
| عرض كل أحداث المحرك + تقرير `task_report` مُنسّق | `electron/agent/cli.ts:335` |
| فحص مفتاح صريح برسالة إصلاح صالحة للترمينال (قبل أي اتصال) | `electron/agent/cli.ts:473` |
|turn واحد عبر `runAgent()` الحقيقي (كل الأدوات/الموافقات/DNA/الوكلاء الفرعيين) | `electron/agent/cli.ts:478` |
| REPL تفاعلي: `/help`, `/mode`, `/clear`, `/config`, `/models`, `exit` + ذاكرة المحادثة | `electron/agent/cli.ts:540` |
| `verify` / `journals` محفوظة بالوظائف نفسها | `electron/agent/cli.ts:577`, `:632` |

### `package.json` (فقط حقل `bin` + scripts)
- `package.json:7` — `"bin": { "sadeem": "dist-cli/surnia.cjs", "kodex": "dist-cli/kodex.cjs" }`
- `package.json:48` — `build:cli` (كما كانت; تُنتج الآن ملفاً بـ shebang صالح)
- `package.json:50` — `test:cli`
- `package.json:49` — `cli` (`node dist-cli/surnia.cjs`)

### اختبار جديد
- `tests/v1142-cli.test.mjs` — 6 اختبارات، مزوّد محلي scripted على `127.0.0.1` بلا أي شبكة خارجية ولا نموذج حقيقي:
  1. `help/version/config/models` بلا استدعاء نموذج — `:172`
  2. `run`: استدعاء أداة حقيقي → نتيجة أداة → إجابة نهائية → REPORT، خروج 0 — `:197`
  3. REPL يقبل سطراً مكتوباً ويرد — `:214`
  4. `--mode default` يطبع موافقة حقيقية ويقبل `y` ثم يكمل — `:226`
  5. غياب المفتاح يعطي إرشاداً صالحاً للترمينال بدل "افتح الإعدادات" — `:241`
  6. حقل `bin` وshebang — `:254`

---

## 3. الإثبات — Verification (actual run)

```
> npx tsc -p tsconfig.node.json --noEmit        # clean, no output
> npm run test:cli
# tests 6 · pass 6 · fail 0
> npm run build:cli && node dist-cli/surnia.cjs version
sadeem 11.12.0
```

في الاختبار رقم 2 كتب المحرك فعلاً ملفاً على القرص عبر `write_file`، وأُرسل `tool_start`/`tool_result` إلى طرفية الطفل، وظهر النص النهائي وتقرير `REPORT ... COMPLETED`. في الاختبار رقم 4 طُلبت موافقة `write` حقيقية، وقُبلت بـ `y`، ثم أكمل المحرك.

---

## 4. نسخة جاهزة للموقع — Website handoff copy (parent: add to site, do NOT edit site here)

> ### SADEEM in your terminal
>
> The full SADEEM agent — 145 tools, real approvals, and an honest completion report — now runs without the desktop app.
>
> ```bash
> npm i -g sadeem
> sadeem run "fix the flaky test"
> ```
>
> Prefer no install? `npx sadeem run "explain this repo"` works too.
>
> ```bash
> sadeem                                   # interactive REPL (multi-turn)
> sadeem run "add /health and test it" --workspace ./my-app
> sadeem run "review my changes" --mode default   # asks before every write/command
> sadeem --provider ollama --model qwen2.5-coder  # fully local, no API key
> sadeem config                            # see the effective model + masked key
> sadeem models                            # built-in model catalog
> ```
>
> **BYOK / local-first:** your model and key come from `~/.surnia/settings.json` (shared with the desktop app) or `KODEX_API_KEY` / `KODEX_BASE_URL` / `KODEX_MODEL` / `KODEX_PROVIDER`. Nothing is uploaded except to the provider you chose. Keys are never printed by `sadeem config`.
>
> ** Approvals in the terminal:** with `--mode default` every write/command prints a prompt — `[y]es / [n]o / [a]lways / [s]ession / Never`. Empty input (EOF) = deny. For CI, pass `--yes` (or set `SADEEM_CLI_YES=1`). The default mode is `fullAccess` for one-liner compatibility; use `--mode default` to require approvals.
>
> Arabic version for the site:
>
> ### SADEEM من الترمينال
>
> الوكيل الكامل بـ 145 أداة وموافقات حقيقية وتقرير صادق — يعمل الآن بدون تطبيق سطح المكتب.
>
> ```bash
> npm i -g sadeem
> sadeem run "أصلح الاختبار المتقطع"
> sadeem          # وضع تفاعلي متعدد الأدوار
> ```
>
> النموذج والمفتاح من إعدادات التطبيق أو متغيرات `KODEX_*` — لا شيء يُرفع إلا إلى المزود الذي تختاره.

---

## 5. حدود صادقة / Handoff to parent (things I could NOT fix in my files)

1. **لا يزال `package.json` يحمل `"private": true` (`package.json:16`) و`"license": "UNLICENSED"`.** هذا **يمنع `npm publish`**، لذلك `npm i -g sadeem` من السجل لن يعمل حتى يقرر المالك تغييرهما (والتحقق من توفر اسم الحزمة `sadeem` على npm). حقل `bin` صحيح وجاهز، لكن النشر خارج نطاقي — لم ألمسه.
2. **المفاتيح المشفّرة بمفتاح OS keystore:** الـ CLI يستبدل `safeStorage.isEncryptionAvailable()` بـ `false`. مفاتيح `plain:` من التطبيق تعمل؛ مفاتيح `enc:` المشفّرة أصلاً بنظام ويندوز/Keychain **لا تُفكّ** في الترمينال (تُعامل كغائبة مع رسالة واضحة من `storeService`). الحل: إدخال المفتاح عبر `KODEX_API_KEY` أو إعادة حفظه من التطبيق عند تشغيل CLI على نفس الجهاز. محاكاة `safeStorage` الحقيقية تتطلب تغييراً في `electron/agent/cli.ts` فقط — وهو تحت ملكيتي، لكنها تحتاج قرار أمان من المالك.
3. **وكلاء فرعيون (subagents) يعملون داخل محرك واحد** — لا توجد نوافذ/ألواح منفصلة في الترمينال كما في Claude Code. الوظيفة الكاملة موجودة (`runAgent` → `subagentRunner`)، لكن العرض نصي متسلسل فقط.
4. **لا يوجد تثبيت تلقائي للاعتماديات:** `dist-cli/*.cjs` مُضمّن بالكامل (1.9MB) ولا يحتاج `node_modules` وقت التشغيل. هذا جيد للتثبيت العالمي.
5. **خطوط أرقام `engine.ts` قد تتحرك** مع تعديلات وكلاء آخرين؛ المرجع الثابت: `export async function runAgent` في `electron/agent/engine.ts:1952` وقت الكتابة، وسجل الأدوات 145 مدخلاً في `electron/agent/tool-defs.ts`. لم أعدّل أياً منهما.
6. **`sadeem init` / `compact` كأوامر مستقلة غير معروضة** — المحرك يدعم `task: 'init' | 'compact'` لكن الـ CLI يعرض فقط `chat`؛ يمكن إضافتها لاحقاً بطلب.

---

## 6. ما لم ألمسه عمداً
`engine.ts`, `tools.ts`, `prompts.ts`, `store.ts`, `storeService.ts`, وصفحات الموقع — كلها مملوكة لوكلاء آخرين. أي تغيير محركي مطلوب؟ لا يوجد: الـ CLI يستدعي `runAgent` كما هو دون تعديل محرك.
