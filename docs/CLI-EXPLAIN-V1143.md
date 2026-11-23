# v11.43 — شو هو الـ CLI؟ / What the CLI actually is & publish-ready package

> **الجمهور / Audience:** المؤسّس (شرح بلا مصطلحات تقية) + المطوّرون (أوامر وتحقق).
> **النطاق / Scope:** شرح فقط + تهيئة `package.json` للنشر. **لم أنشر على npm.** قرار النشر بيد المؤسّس.

---

## 0. الجواب المختصر — بالعربي (كما سأل المؤسّس)

سؤالك كان: *«اشرح لي عن السي اي، هاي شو قصتها، إنه حزمة الNPM يعني مثلا إنه الشخص بيقدر يستخدم التطبيق جوا الترمينال، هيك قصدك بالسي اي؟»*

**الجواب: نعم، بالضبط هذا قصدي — ولا شيء أقل ولا شيء أكثر.**

- **CLI** اختصار `Command Line Interface` = «واجهة سطر الأوامر»، يعني الترمينال.
- الـ CLI ** ليس تطبيقاً ثانياً**، وليس نسخة «خفيفة» (lite) من SADEEM. هو **نفس المحرك** (`runAgent()`) اللي يشغّل تطبيق سطح المكتب، بس بدل ما تضغط على أزرار في نافذة، بتكتب أوامر في الترمينال.
- تشبيه بسيط: **نفس السيارة، بس مقود مختلف.** المحرك، الأدوات (145 أداة)، الذاكرة، الموافقات، والنماذج — كلها نفسها.
- «حزمة NPM» معناها: نرفع SADEEM على موقع الحزم الرسمي لجافاسكربت، وبعدها أي شخص بالعالم يكتب سطر واحد ويتثبّت عنده الأمر `sadeem` في الترمينال:

```bash
npm i -g sadeem          # تثبيت مرة واحدة على الجهاز
sadeem run "أصلح الاختبار المتقطع"   # شغّل الوكيل من الترمينال
sadeem                    # افتح محادثة تفاعلية (REPL) متعددة الأدوار
```

يعني اللي قلتَه صحيح حرفياً: **الشخص بيستخدم التطبيق جوا الترمينال.** هذا بالضبط اللي صار في v11.42، وهذا الإصدار (v11.43) يشرحه ويجهّز الحزمة للنشر.

> **تنويه صادق:** حتى هذه اللحظة لم أنشر الحزمة على npm. التثبيت بالسطر أعلاه سيصبح حقيقة **بعد** أن يقرّر المؤسّس تشغيل `npm publish`. كل شيء تقني جاهز؛ قرار النشر وحده باقٍ. التفاصيل في القسم 5.

---

## 1. Short English version

**CLI = Command Line Interface — the terminal.** It is **not** a second app and **not** a lite build. It is the **exact same engine** (`runAgent()`) that powers the desktop app, just driven by typed commands instead of clicks. Same 145-tool registry, same real approval prompts, same conversation memory, same BYOK/local-first model setup, same honest completion report.

`npm i -g sadeem` installs a global `sadeem` command; `sadeem run "<task>"` runs one task, and plain `sadeem` opens an interactive multi-turn REPL. Once published, anyone can use SADEEM inside their terminal with one line. **Not published yet — that decision is left to the founder.**

---

## 2. ما يعمل فعلاً — What is REAL (proven by tests)

| الشيء / Feature | الحقيقة / Reality | الدليل / Evidence |
|---|---|---|
| نفس المحرك | `sadeem run` يستدعي `runAgent()` الحقيقي — **ليس** نسخة مبسّطة | `tests/v1142-cli.test.mjs:9`، `:197` |
| 145 أداة | نفس سجل أدوات سطح المكتب (`tool-defs.ts`) | `docs/CLI-AGENT-V1142.md:8`، `:128` |
| موافقات حقيقية | `--mode default` يسأل فعلاً: `[y]es/[n]o/[a]lways/[s]ession/Never`؛ الإدخال الفارغ (EOF) = رفض | `docs/CLI-AGENT-V1142.md:42`، اختبار 4 `:226` |
| ذاكرة | REPL متعدد الأدوار يحتفظ بالسياق + DNA/Playbook من نفس المحرك | `docs/CLI-AGENT-V1142.md:46` |
| نماذج | كتالوج حقيقي (`sadeem models`) + BYOK/local-first من `~/.surnia/settings.json` أو `KODEX_*` | `docs/CLI-AGENT-V1142.md:40`، `:102` |
| تقرير صادق | أحداث المحرك + `REPORT … COMPLETED` في النهاية | `docs/CLI-AGENT-V1142.md:43`، `:76` |
| وكيل فرعي | يعمل داخل نفس المحرك (`subagentRunner`) | `docs/CLI-AGENT-V1142.md:126` |
| تثبيت عالمي | ملفات `dist-cli/*.cjs` مضمّنة بالكامل (~2MB) — **لا تحتاج `node_modules` وقت التشغيل** | `docs/CLI-AGENT-V1142.md:127` |

### أوامر عملية — concrete commands (from `docs/CLI-AGENT-V1142.md:86-118`)

```bash
npm i -g sadeem                                  # تثبيت عالمي / global install
npx sadeem run "explain this repo"               # بدون تثبيت / no install

sadeem run "fix the flaky test"                  # مهمة واحدة / single task
sadeem                                           # REPL تفاعلي / interactive multi-turn
sadeem run "add /health and test it" --workspace ./my-app
sadeem run "review my changes" --mode default    # يسأل قبل كل تعديل / asks before each write
sadeem --provider ollama --model qwen2.5-coder   # محلي 100% بلا مفتاح / fully local
sadeem config                                    # الإعدادات الفعّالة + مفتاح مقنّع / masked key
sadeem models                                    # كتالوج النماذج / model catalog
sadeem help | sadeem version | sadeem verify | sadeem journals
```

داخل الـ REPL: `/help`, `/mode`, `/clear`, `/config`, `/models`, `exit` (`docs/CLI-AGENT-V1142.md:46`).

لـ CI: مرّر `--yes` أو `SADEEM_CLI_YES=1` (الافتراضي `*fullAccess*` للتوافق مع الأوامر السريعة — استخدم `--mode default` إذا ترد الموافقات) (`docs/CLI-AGENT-V1142.md:104`).

---

## 3. ما الذي **ليس** صادقاً بعد — honest limits (from `docs/CLI-AGENT-V1142.md:122-129`)

1. **المفاتيح المشفّرة بمفتاح نظام التشغيل (OS keystore) لا تُفكّ في الترمينال.** الـ CLI يستبدل `safeStorage.isEncryptionAvailable()` بـ `false`. مفاتيح `plain:` من التطبيق تعمل طبيعياً؛ أمّا مفاتيح `enc:` المشفّرة بـ Windows DPAPI / Keychain فتُعامل كأنها غائبة مع رسالة واضحة من `storeService`. **الحل:** مرّر المفتاح عبر `KODEX_API_KEY`، أو أعد حفظه من التطبيق أثناء تشغيل CLI على نفس الجهاز. محاكاة `safeStorage` الحقيقية تحتاج قرار أمان من المؤسّس (تغيير في `electron/agent/cli.ts` — خارج ملكيتي في هذه المهمة). — `docs/CLI-AGENT-V1142.md:125`
2. **الوكلاء الفرعيون بلا نوافذ منفصلة.** الوظيفة الكاملة موجودة، لكن العرض نصّي متسلسل فقط، وليس ألواحاً منفصلة كما في Claude Code. — `docs/CLI-AGENT-V1142.md:126`
3. **لا يوجد `sadeem init` / `sadeem compact` كأمرين مستقلين** (المحرك يدعمهما كـ `task`، لكن الـ CLI يعرض `chat` فقط). — `docs/CLI-AGENT-V1142.md:129`
4. **لم يُنشر على npm بعد.** انظر القسم 5.

---

## 4. تهيئة الحزمة للنشر — publish-ready `package.json`

تعديلاتي (الحقول المسموحة لي فقط: name/version/license/private/bin/files/scripts/description):

| الحقل / Field | قبل / Before | بعد / After | السطر / Line |
|---|---|---|---|
| `description` | وصف قديم طويل Specific to v11.12 | وصف مختصر يذكر الـ CLI و145 أداة | `package.json:5` |
| `license` | `"UNLICENSED"` | **`"MIT"`** | `package.json:16` |
| `private` | `true` (يمنع `npm publish`) | **`false`** | `package.json:21` |
| `files` | غير موجود | **`["dist-cli","README.md","LICENSE"]`** | `package.json:11-15` |
| `bin` | موجود | **باقٍ كما هو** | `package.json:7-10` |
| `name` | `"sadeem"` | **باقٍ كما هو** | `package.json:2` |

**لم ألمس:** `dependencies`, `devDependencies`, كل `scripts` (بما فيها `build:cli` و`test:cli`), `main`, `author`, `version`, `allowScripts`, وأي ملف مصدر.

### فحص توفر الاسم — name availability (read-only)

```
> npm view sadeem name version
npm error 404 Not Found - GET https://registry.npmjs.org/sadeem - Not found
npm error 404 'sadeem@*' is not in this registry.
```

**النتيجة:** الاسم `sadeem` **متاح** وقت الفحص (404 = غير مسجّل)، لذلك لا حاجة للاسم البديل `@sadeem/sadeem`. ملاحظة صادقة: الأسماء تُسجّل في أي لحظة — أعد الفحص مباشرة قبل النشر. لم أشغّل أي أمر كتابة على السجل.

### افتراض الترخيص — license assumption

**لا يوجد ملف `LICENSE` في جذر المشروع** (فحصت الجذر: يوجد `README.md` فقط، و`docs/LICENSE-SECURITY-V1133.md` وثيقة أمان مختلفة). لذلك اخترت `MIT` كـ **افتراض** لترخيص كود SADEEM نفسه، بناءً على طلب المهمة.

> ⚠️ **مطلوب من المؤسّس (خارج ملكيتي):** أضف ملف `LICENSE` في الجذر يحمل نص MIT الفعلي. بدون الملف، `npm pack` لن يُرفق نص الترخيص رغم أن `"LICENSE"` مذكور في `files` (npm يُرفق LICENSE تلقائياً **عند وجوده**). هذا لا يوقف النشر تقنياً، لكنه يترك الحزمة بلا نص ترخيص منشور.

### ملاحظة حجم الحزمة — honest pack note

`npm pack --dry-run` يُرفق أيضاً `dist-electron/electron/main.js` (3.1MB) **رغم أنه غير مذكور في `files`**، لأن npm يُرفق دائماً الملف الذي يشير إليه حقل `main` (`package.json:6`). الـ CLI لا يحتاجه. تقليص الحزمة يتطلب تغيير `main` أو تقسيم الحزمة — **خارج الحقول المسموحة لي**، أتركه قراراً للمؤسّس/الوالد.

---

## 5. التحقق — Verification (actual runs, all green)

```bash
node -e "console.log(require('./package.json').bin)"
# { sadeem: 'dist-cli/surnia.cjs', kodex: 'dist-cli/kodex.cjs' }

npm pack --dry-run
# package: sadeem@11.12.0
# Tarball Contents: README.md, dist-cli/kodex.cjs, dist-cli/surnia.cjs,
#                   dist-electron/electron/main.js (force-included via main), package.json
# total files: 5 · package size 1.8 MB · unpacked 7.1 MB

npx tsc -p tsconfig.node.json --noEmit     # clean, no output

npm run test:cli
# tests 6 · pass 6 · fail 0
```

الاختبارات الستة: `help/version/config/models`، `run` بأداة حقيقية، REPL، موافقة حقيقية، إرشاد المفتاح، حقل `bin` — كلها نجحت (`tests/v1142-cli.test.mjs`).

---

## 6. قرار النشر بيد المؤسّس — publish decision (NOT executed)

**لم أنفّذ `npm publish`.** هذا فعل حقيقي على السجل العام ولم تأذن به. عندما تقرّر، الأوامر بالترتيب:

```bash
npm view sadeem name version        # 1) أعد تأكيد أن الاسم ما زال متاحاً
npm login                           # 2) سجّل الدخول بحساب npm تملكه
npm pack --dry-run                  # 3) راجع محتوى الحزمة مرة أخيرة
npm publish --access public         # 4) انشر (أول نشر public)
# أو: npm publish                    #    كافٍ للحزم غير المقيدة بـ scope
```

بعد النشر يصبح هذا صحيحاً فعلياً:

```bash
npm i -g sadeem
sadeem run "fix the flaky test"
sadeem
```

**الخلاصة للمؤسّس:** التقنيات جاهزة ومُختبرة (6/6)، الاسم متاح، الحزمة مهيّأة. ينقص فقط: (أ) ملف `LICENSE` بنص MIT، و(ب) قرارك أنت بالنشر.

---

### مراجع / References
- `package.json:2` (name), `:5` (description), `:7-10` (bin), `:11-15` (files), `:16` (license), `:21` (private)
- `docs/CLI-AGENT-V1142.md:8` (نفس المحرك / same engine), `:86-118` (الأوامر / commands), `:122-129` (الحدود / limits)
- `tests/v1142-cli.test.mjs:9`, `:197`, `:226`, `:254`
