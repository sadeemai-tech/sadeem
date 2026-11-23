'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Download, Link2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLang } from '@/lib/i18n';
import { SITE } from '@/lib/site';
import './docs.css';

type Bi = [string, string];

type Section = {
  id: string;
  index: string;
  navEn: string;
  navAr: string;
  titleEn: string;
  titleAr: string;
  paras: Bi[];
  tags?: string[];
  code?: string;
  list?: Bi[];
  note?: Bi;
  cta?: boolean;
};

/* SIGNATURE ELEMENT — an open field manual. The page lines rule themselves
   in with a staggered ink-stroke animation; no external image is used. */
function OpenBook() {
  const { tx } = useLang();
  const rows = Array.from({ length: 6 }, (_, i) => i);
  return (
    <svg className="docs-book am-sway" viewBox="0 0 420 300" role="img" aria-label={tx('An open documentation manual', 'دليل توثيق مفتوح')}>
      {/* mirrored page curvature; each page closes along the same binding arc.
          The edge + spine write themselves once, then the whole manual
          settles weightlessly on its binding — a book coming to rest. */}
      <path className="docs-book-page" d="M210 62C168 44 116 48 74 60V248C116 236 168 240 210 250C206 202 206 110 210 62Z" />
      <path className="docs-book-page" d="M210 62C252 44 304 48 346 60V248C304 236 252 240 210 250C214 202 214 110 210 62Z" />
      <path className="docs-book-edge am-draw" pathLength={1} d="M74 60C116 48 168 44 210 62C252 44 304 48 346 60M74 248C116 236 168 240 210 250C252 240 304 236 346 248" />
      <path className="docs-book-spine am-draw" pathLength={1} d="M210 62v188" />
      {/* ruled lines tilt toward the binding: on the left page they rise 6px
          as they near the spine, mirrored on the right — one perspective. */}
      <g className="docs-book-lines">
        {rows.map((i) => (
          <g key={i}>
            <line className="docs-book-line" style={{ animationDelay: `${0.22 + i * 0.1}s` }} x1="94" y1={98 + i * 22} x2="194" y2={92 + i * 22} />
            <line className="docs-book-line" style={{ animationDelay: `${0.3 + i * 0.1}s` }} x1="226" y1={92 + i * 22} x2="326" y2={98 + i * 22} />
          </g>
        ))}
      </g>
      <circle className="docs-book-mark am-node-pulse" cx="280" cy="226" r="13" />
      <path className="docs-book-mark am-draw" pathLength={1} d="M274 226h12M280 220v12" />
    </svg>
  );
}

/* Code snippets reveal as if typed when they scroll into view. */
function CodeReveal({ code }: { code: string }) {
  const [shown, setShown] = useState(false);
  return (
    <motion.div
      className={'panel panel-pad doc-code' + (shown ? ' is-typed' : '')}
      initial={false}
      viewport={{ once: true, amount: 0.3 }}
      onViewportEnter={() => setShown(true)}
    >
      <pre dir="ltr"><code>{code}</code></pre>
    </motion.div>
  );
}

const INSTALL_CODE = `# desktop — Windows installer (or the portable ZIP)
.\\${SITE.download.exe.split('/').pop()}
Expand-Archive .\\${SITE.download.zip.split('/').pop()} -DestinationPath .\\SADEEM
.\\SADEEM\\SADEEM.exe

# CLI — published package, same engine as the desktop app
npm i -g sadeem-cli
sadeem version          # prints 11.12.0
sadeem run "explain this repo"
sadeem                  # interactive REPL`;

const SECTIONS: Section[] = [
  {
    id: 'quickstart',
    index: '01',
    navEn: 'Quickstart',
    navAr: 'بدء سريع',
    titleEn: 'Quickstart',
    titleAr: 'البدء السريع',
    paras: [
      [
        'Install the Windows desktop app or the published CLI. Both run the same engine, the same 145 tools and the same approval rules. Add a provider key, run a small task, then review the diff.',
        'ثبّت تطبيق ويندوز أو الأداة الطرفية المنشورة. كلاهما يشغّل المحرك نفسه و١٤٥ أداة وقواعد الموافقة نفسها. أضف مفتاح مزوّد، شغّل مهمة صغيرة، ثم راجع الفروق.',
      ],
      [
        'Verify the CLI with sadeem version — it prints 11.12.0. Your provider bills you for model calls; SADEEM does not sell inference.',
        'تحقق من الأداة الطرفية بـ sadeem version — تطبع 11.12.0. مزوّدك يفاترك على نداءات النماذج؛ سديم لا يبيع الاستدلال.',
      ],
    ],
    code: INSTALL_CODE,
    list: [
      [
        'Settings, chats, playbook and accounts live in your user app-data folder.',
        'الإعدادات والمحادثات والدليل الحي والحسابات تُحفظ في مجلد بيانات التطبيق الخاص بمستخدمك.',
      ],
      [
        'The CLI resolves a key from a flag, an environment variable or local settings — it never prints the key.',
        'تحلّ الأداة الطرفية المفتاح من علم أو متغير بيئة أو إعدادات محلية — ولا تطبع المفتاح أبداً.',
      ],
      [
        'The built-in updater checks the release feed; you can also install a release manually.',
        'يتحقق المحدّث المدمج من موجز الإصدارات — ويمكنك أيضاً تثبيت إصدار يدوياً.',
      ],
    ],
  },
  {
    id: 'concepts',
    index: '02',
    navEn: 'Concepts',
    navAr: 'المفاهيم',
    titleEn: 'How the agent works',
    titleAr: 'كيف يعمل الوكيل',
    paras: [
      [
        'SADEEM is a local-first coding agent for Windows and the terminal. It reads files, runs commands, calls tools and reports what changed.',
        'سديم وكيل برمجة محلي على ويندوز وفي الطرفية. يقرأ الملفات ويشغّل الأوامر ويستدعي الأدوات ويُبلّغ بما تغيّر.',
      ],
      [
        'Each turn dispatches the tool registry behind an approval gate. Long tasks continue across rounds without a silent round cap and compact at the model’s real context window. Every terminal path ends with a structured report: what completed, what failed and what was touched. Failed tool calls are reported as errors, not as a clean success.',
        'كل دورة تُرسل سجل الأدوات عبر بوابة موافقة. تستمر المهام الطويلة في جولات جديدة بلا سقف دورات مخفي، ويُضغط السياق عند النافذة الحقيقية للنموذج. ينتهي كل مسار بتقرير منظّم: ما اكتمل، وما فشل، وما تعديل. تُبلَّغ النداءات الفاشلة كأخطاء لا كنجاح.',
      ],
    ],
    code: 'read_file → run_command → test_run → task_report\n# a failed tool call forces an error outcome, not a clean "completed"',
    list: [
      [
        'Permission modes: plan, default, autoEdit, fullAccess. Plan and review modes are read-only.',
        'أوضاع الصلاحية: plan وdefault وautoEdit وfullAccess. وضعا plan والمراجعة للقراءة فقط.',
      ],
      [
        'The harness checks claims against files, commands and tests; a signed proof package can be re-run.',
        'يحقق النظام من الادعاءات مقابل الملفات والأوامر والاختبارات؛ وحزمة الإثبات الموقّعة قابلة لإعادة التشغيل.',
      ],
      [
        'Tool choice is the model’s job. The gates check evidence, not intent.',
        'اختيار الأداة مهمة النموذج. البوابات تفحص الأدلة، لا النية.',
      ],
    ],
  },
  {
    id: 'cli',
    index: '03',
    navEn: 'CLI',
    navAr: 'الأداة الطرفية',
    titleEn: 'CLI commands',
    titleAr: 'أوامر الأداة الطرفية',
    paras: [
      [
        'The sadeem-cli package installs two binaries: sadeem and kodex. Run one task and exit, or open a multi-turn REPL that keeps memory.',
        'تُثبّت حزمة sadeem-cli ملفين تنفيذيين: sadeem وkodex. شغّل مهمة واحدة ثم اخرج، أو افتح REPL متعدد الأدوار يحتفظ بالذاكرة.',
      ],
      [
        'The CLI calls the same engine as the desktop app: 145 tools, approval prompts, DNA/playbook memory and subagents. No Electron binary is needed. Verify an install with sadeem version; inspect a run with sadeem journals or sadeem verify <proof.json> --rerun.',
        'تستدعي الأداة الطرفية المحرك نفسه الذي يستدعيه تطبيق سطح المكتب: ١٤٥ أداة ونوافذ موافقة وذاكرة DNA/الدليل الحي ووكلاء فرعيون. لا حاجة لملف Electron. تحقق من التثبيت بـ sadeem version، ومن تشغيل بـ sadeem journals أو sadeem verify <proof.json> --rerun.',
      ],
    ],
    code: 'npm i -g sadeem-cli          # install once\nsadeem run "fix the flaky test"   # one task, then exit\nsadeem                       # interactive REPL\nsadeem models                # model catalog\nsadeem config                # effective settings, keys masked\nsadeem verify proof.json --rerun\nsadeem journals              # crash-resilient run journals\nsadeem help | sadeem version',
    list: [
      [
        'Add --workspace ./my-app to target another folder.',
        'أضف --workspace ./my-app لاستهداف مجلد آخر.',
      ],
      [
        'Use --mode default to ask before each write; use --yes for unattended runs.',
        'استخدم --mode default للسؤال قبل كل كتابة، و--yes للتشغيل دون تدخل.',
      ],
      [
        'Inside the REPL: /help, /mode, /clear, /models, exit.',
        'داخل REPL: /help و/mode و/clear و/models وexit.',
      ],
    ],
    note: [
      'An OS-keystore key saved by the desktop app is not decrypted by the CLI. Pass the key through a flag, an environment variable, or local settings instead.',
      'المفتاح المشفّر في مخزن النظام من التطبيق لا تفكّه الأداة الطرفية. مرّر المفتاح عبر علم أو متغير بيئة أو إعدادات محلية بدلاً من ذلك.',
    ],
  },
  {
    id: 'api-key',
    index: '04',
    navEn: 'Add your API key',
    navAr: 'أضف مفتاح المزوّد',
    titleEn: 'Add your API key',
    titleAr: 'أضف مفتاح المزوّد',
    paras: [
      [
        'Open Settings → AI providers. Paste a key, press Enable. SADEEM fetches a newest-first model list and picks a default; if the catalog is unreachable, curated presets are used.',
        'افتح الإعدادات ← مزودو الذكاء الاصطناعي. الصق مفتاحاً واضغط تفعيل. يجلب سديم قائمة نماذج مرتبة بالأحدث ويختار افتراضياً؛ وإذا تعذّر الوصول للكتالوج تُستخدم قوائم معدة مسبقاً.',
      ],
    ],
    code: 'Settings → AI providers\n→ OpenRouter / Anthropic / OpenAI / Google / …\n→ paste key → Enable → models discovered → default selected',
    note: [
      'Keys stay in local settings and go straight to the provider you chose. Your provider bills you. The CLI resolves keys locally and never prints them.',
      'تبقى المفاتيح في إعدادات محلية وتنطلق مباشرة إلى المزوّد الذي اخترته. مزوّدك يفاترك. الأداة الطرفية تحلّ المفاتيح محلياً ولا تطبعها.',
    ],
  },
  {
    id: 'models',
    index: '05',
    navEn: 'Models & providers',
    navAr: 'النماذج والمزوّدون',
    titleEn: 'Models & providers',
    titleAr: 'النماذج والمزوّدون',
    paras: [
      [
        'Bring your own key: Claude, GPT, Gemini, GLM, DeepSeek, Ollama and more. OpenRouter adds a live, newest-first catalog; a local Ollama model needs no key at all. The reasoning control maps to Anthropic thinking, OpenAI o-series reasoning effort and OpenRouter reasoning.',
        'أحضر مفتاحك: كلود، جي بي تي، جيميناي، جي إل إم، ديب سيك، أولاما وغيرها. يضيف مزوّد التوجيه العام كتالوجاً حياً مرتباً بالأحدث، بينما لا يحتاج أولاما المحلي إلى مفتاح إطلاقاً. يتوافق التحكم في الاستدلال مع تفكير أنثروبيك ومستويات السلسلة أو واستدلال مزوّد التوجيه العام.',
      ],
    ],
    tags: ['Claude', 'GPT', 'Gemini', 'GLM', 'DeepSeek', 'Ollama', 'OpenRouter'],
    note: [
      'Higher reasoning means deeper thinking on hard problems, but slower and more expensive. Your provider sets the price.',
      'الاستدلال الأعلى يعني تفكيراً أعمق في المسائل الصعبة، لكنه أبطأ وأغلى. مزوّدك يحدّد السعر.',
    ],
  },
  {
    id: 'tools',
    index: '06',
    navEn: 'Tools',
    navAr: 'الأدوات',
    titleEn: 'Tools & approval',
    titleAr: 'الأدوات والموافقة',
    paras: [
      [
        'The 145 tools are grouped by what they do: understand the workspace; edit and run; code intelligence; build artifacts; web and desktop; data and QA; workflow and memory; git and utilities.',
        'الأدوات الـ١٤٥ مجمّعة بحسب وظيفتها: فهم مساحة العمل؛ التعديل والتشغيل؛ ذكاء الكود؛ إنتاج الملفات؛ الويب وسطح المكتب؛ البيانات والجودة؛ سير العمل والذاكرة؛ Git والأدوات المساعدة.',
      ],
      [
        'Tool profiles change what the model is advertised for one turn. Essential, balanced and full are the familiar views; the rest are category views. Every tool stays callable by its exact name, and strong models see the full registry. External-server tools are never filtered.',
        'تغيّر ملفات الأدوات ما يُعرض للنموذج في دورة واحدة. الأساسي والمتوازن والكامل هي العروض المألوفة، والباقي عروض حسب الفئة. كل أداة تبقى قابلة للنداء باسمها الدقيق، والنماذج القوية ترى السجل الكامل. أدوات الخوادم الخارجية لا تُستبعد أبداً.',
      ],
    ],
    code: '{ "agent": { "toolProfile": "balanced" } }\n// profiles are a view · dispatch always resolves the full 145-tool registry',
    list: [
      [
        'Approval modes: plan, default, autoEdit, fullAccess. Always-allow and deny rules persist per workspace; deny wins.',
        'أوضاع الموافقة: plan وdefault وautoEdit وfullAccess. قواعد السماح الدائم والرفض تُحفظ لكل مساحة عمل، والرفض يتقدّم.',
      ],
      [
        'Auto-approved writes still get a rollback checkpoint.',
        'الكتابات الموافق عليها تلقائياً تحصل أيضاً على نقطة استعادة.',
      ],
      [
        'LSP, browser and external QA tools need the matching local runtime installed.',
        'أدوات LSP والمتصفح والجودة الخارجية تحتاج التشغيل المحلي المقابل مثبتاً.',
      ],
    ],
  },
  {
    id: 'mcp',
    index: '07',
    navEn: 'MCP catalog',
    navAr: 'سجل الخوادم',
    titleEn: 'MCP catalog & adding a server',
    titleAr: 'سجل الخوادم وإضافة خادم',
    paras: [
      [
        'Model Context Protocol servers add external tools over stdio, streamable HTTP or SSE. Open Settings → Servers → Add server, enter a name, a command and its arguments, press Test, then enable it. Review the command before adding a community server.',
        'تضيف خوادم بروتوكول سياق النموذج أدوات خارجية عبر stdio أو HTTP المتدفق أو SSE. افتح الإعدادات ← الخوادم ← إضافة خادم، أدخل الاسم والأمر ووسائطه، اضغط اختبار ثم فعّله. راجع الأمر قبل إضافة خادم مجتمعي.',
      ],
    ],
    code: 'Name: files\nCommand: npx\nArgs: -y @modelcontextprotocol/server-filesystem C:\\projects',
    list: [
      [
        'Descriptions are scanned for tool poisoning; a flagged server can be quarantined.',
        'تفحص الأوصاف بحثاً عن تسميم الأدوات؛ ويمكن حظر الخادم المُشتبه به.',
      ],
      [
        'Tool definitions are hash-pinned: a changed description needs re-approval.',
        'تعريفات الأدوات مثبتة ببصمة: أي تغيير في الوصف يحتاج موافقة جديدة.',
      ],
      [
        'Health state and the call log are visible in the servers panel.',
        'حالة الاتصال وسجل النداءات ظاهران في لوحة الخوادم.',
      ],
      [
        'External-server tools are never filtered by the tool profile.',
        'أدوات الخوادم الخارجية لا تُستبعد من أي ملف أدوات.',
      ],
    ],
  },
  {
    id: 'subagents',
    index: '08',
    navEn: 'Subagents',
    navAr: 'الوكلاء الفرعيون',
    titleEn: 'Subagents',
    titleAr: 'الوكلاء الفرعيون',
    paras: [
      [
        'Sixteen specialists run their own loop with the full tool registry. Roles differ by prompt — explore, debugger, security, docs — not by permissions. Use the task tool for isolated work; background results arrive as messages.',
        'ستة عشر وكيلاً متخصصاً يشغّل كل منهم حلقة كاملة بسجل الأدوات الكامل. تختلف الأدوار بالتوجيه — مستكشف، مصحح، أمني، توثيق — لا بالصلاحيات. استخدم أداة task للعمل المعزول؛ وتصل نتائج الخلفية كرسائل.',
      ],
    ],
    code: 'task("audit the auth module and propose minimal fixes")\n// background: true → summary arrives as a message',
  },
  {
    id: 'playbook',
    index: '09',
    navEn: 'Living Playbook',
    navAr: 'الدليل الحي',
    titleEn: 'Living Playbook',
    titleAr: 'الدليل الحي',
    paras: [
      [
        'After a completed run the app writes worked, failed, preferences and recipes into PLAYBOOK.md and keeps a version history with diffs. The next run reads it as advice; your current request overrides it and learned facts never become bans.',
        'بعد اكتمال المهمة يكتب التطبيق ما نجح وما فشل والتفضيلات والوصفات في PLAYBOOK.md، ويحتفظ بسجل إصدارات مع فروق. المهمة التالية تقرأه كتوجيه؛ وطلبك الحالي يتقدّم عليه، ولا تتحول الحقائق المتعلّمة إلى قيود.',
      ],
      [
        'The DNA Insights lens explains what is stored — confidence, repetition, the rule behind each fact — and whether it reaches the next prompt. When the active window fills, the oldest well-learned fact retires so a new one is never dropped. Ask about an old decision and recall_memory returns the real excerpt and session title.',
        'تشرح عدسة «رؤى الحمض» ما هو مخزّن — الثقة والتكرار والقاعدة وراء كل حقيقة — وما إذا كانت ستصل إلى التوجيه التالي. وعند امتلاء النافذة يُقاعد أقدم معلومة تعلّمها جيداً كي لا تُسقط معلومة جديدة. واسأل عن قرار قديم فيُعيد recall_memory المقطع الحقيقي وعنوان الجلسة.',
      ],
    ],
    code: 'workspace → PLAYBOOK.md + revision history   (plain markdown)',
    note: [
      'The playbook is local to the workspace. Inspect its history or clear it from the Playbook panel.',
      'الدليل محلي لمساحة العمل. راجع سجله أو امسحه من لوحة الدليل.',
    ],
  },
  {
    id: 'schedules',
    index: '10',
    navEn: 'Schedules',
    navAr: 'الجدولة',
    titleEn: 'Schedules & flows',
    titleAr: 'الجدولة والمسارات',
    paras: [
      [
        'A schedule puts agent work on a cron — reviews, digests, maintenance. Jobs can also watch a file, listen on a local webhook, or react to a CI failure. At fire time the same engine runs headlessly; if the workspace tests fail, the result is suppressed. Every fire is recorded in a durable ledger with exact next-run time, error count and duration.',
        'المهمة المجدولة تضع عمل الوكيل على جدول دوري — مراجعات وملخصات وصيانة. ويمكن للمهمة أيضاً مراقبة ملف أو الاستماع إلى webhook محلي أو التفاعل مع فشل في CI. عند الموعد يشغّل المحرك نفسه بلا واجهة؛ وإذا فشلت اختبارات المساحة لا يُعرض النتيجة. وكل تشغيل يُسجّل في سجل دائم بموعده التالي الدقيق وعدد الأخطاء والمدة.',
      ],
      [
        'Flows are named prompts you trigger yourself. SADEEM can offer to save a prompt you repeat, keeping the original text.',
        'المسارات طلبات مُسمّاة تطلقها بنفسك. يمكن لسديم أن يقترح حفظ طلب متكرر مع الاحتفاظ بنصه الأصلي.',
      ],
    ],
    code: '0 9 * * 1-5    # weekdays at 09:00 — daily digest\n/schedule      # workspace control center',
  },
  {
    id: 'worktrees',
    index: '11',
    navEn: 'Worktrees',
    navAr: 'مساعات العمل',
    titleEn: 'Worktrees',
    titleAr: 'مساعات العمل',
    paras: [
      [
        'Isolated git worktrees let several agents work on the same repository without fighting over files. Create one from the workspace control center, then merge or remove it there. Before an allowed write the app takes a git shadow-commit without touching your index or stash; /undo restores files and the conversation together.',
        'تسمح مساعات العمل المعزولة لعدة وكلاء بالعمل على نفس المستودع دون تضارب الملفات. أنشئ واحدة من مركز تحكم المساحة، ثم ادمجها أو أزلها من هناك. وقبل الكتابة المسموح بها يأخذ التطبيق نسخة shadow-commit دون لمس الفهرس أو الـstash، ويُرجع /undo الملفات والمحادثة معاً.',
      ],
    ],
    code: 'git worktree add ../sadeem-feature -b feature/new-ui\n# Workspace → Worktrees → Merge / Remove\n# /undo  → restore files + conversation',
  },
  {
    id: 'config',
    index: '12',
    navEn: 'Configuration',
    navAr: 'الإعدادات',
    titleEn: 'Configuration',
    titleAr: 'الإعدادات',
    paras: [
      [
        'Configure providers, tool profiles, permission modes and MCP servers in Settings. The CLI reads the same settings and accepts flags for a single run.',
        'اضبط المزوّدين وملفات الأدوات وأوضاع الصلاحية وخوادم MCP من الإعدادات. الأداة الطرفية تقرأ الإعدادات نفسها وتقبل أوامر علم لمرة واحدة.',
      ],
    ],
    code: '{ "agent": { "toolProfile": "balanced" }, "permissions": { "mode": "default" } }\n# CLI: sadeem config  → effective settings, keys masked',
    list: [
      [
        'Tool profile: essential, balanced, full, or a category view.',
        'ملف الأدوات: أساسي أو متوازن أو كامل أو عرض حسب الفئة.',
      ],
      [
        'Permission mode: plan, default, autoEdit, fullAccess.',
        'وضع الصلاحية: plan أو default أو autoEdit أو fullAccess.',
      ],
      [
        'Workspace learning files are plain markdown and JSON you can read, edit or delete.',
        'ملفات التعلّم في مساحة العمل هي Markdown وJSON عاديان تقرأهما وتعدّلهما وتحذفهما.',
      ],
    ],
  },
  {
    id: 'accounts',
    index: '13',
    navEn: 'Accounts & pairing',
    navAr: 'الحسابات والاقتران',
    titleEn: 'Accounts & pairing',
    titleAr: 'الحسابات والاقتران',
    paras: [
      [
        'Accounts are created by the desktop app — the website never creates one. In SADEEM choose Sign in → Continue on website. The app mints a six-character pair code with a fifteen-minute lifetime and one use, then opens the pairing page. This site asks for your name and email, then one button navigates to the operating-system deep link below.',
        'الحسابات تُنشأ في تطبيق سطح المكتب — الموقع لا ينشئ حساباً أبداً. في سديم اختر تسجيل الدخول ← المتابعة عبر الموقع. يُنشئ التطبيق رمز اقتران من ستة أحرف صالح خمسة عشر دقيقة ويُستخدم مرة واحدة، ثم يفتح صفحة الاقتران. يطلب الموقع اسمك وبريدك، ثم زر واحد ينتقل إلى الرابط العميق التالي.',
      ],
    ],
    code: 'sadeem://auth/callback?pair=ABC234&email=you%40example.com&name=Layla&plan=free',
    list: [
      [
        'The app validates the pair, then creates or refreshes a local account — reusing an email keeps the same account id.',
        'يتحقق التطبيق من الرمز ثم ينشئ أو يحدّث حساباً محلياً — وإعادة استخدام البريد تحتفظ بنفس معرّف الحساب.',
      ],
      [
        'There is no server-side password, no verification email and no account database in this build.',
        'لا توجد كلمة مرور على خادم ولا بريد تحقق ولا قاعدة حسابات في هذه النسخة.',
      ],
      [
        'The website remembers your details only in this browser; “Forget” removes them there only.',
        'يتذكر الموقع بياناتك في هذا المتصفح فقط؛ و«انسَ» تحذفها من هناك فقط.',
      ],
    ],
    cta: true,
  },
  {
    id: 'privacy',
    index: '14',
    navEn: 'Privacy',
    navAr: 'الخصوصية',
    titleEn: 'Privacy',
    titleAr: 'الخصوصية',
    paras: [
      [
        'API keys, conversations, DNA, the playbook, server configuration and accounts live on your machine. During pairing the deep link carries your name, email, plan and an optional license key to your own app — not to a server. Text fetched from a page, an MCP server or a repo README is marked with its origin; a hostile instruction in that text cannot push an install or destructive command through on autopilot. The CLI resolves keys locally.',
        'مفاتيح الوصول والمحادثات والحمض النووي والدليل الحي وإعدادات الخوادم والحسابات كلها على جهازك. أثناء الاقتران يحمل الرابط العميق اسمك وبريدك وخطتك ومفتاح رخصة اختياري إلى تطبيقك أنت — لا إلى خادم. يُوسَم النص القادم من صفحة أو سيرفر MCP أو ملف README بمصدره؛ ولا تستطيع تعليمات ضارة فيه دفع أمر تثبيت أو أمر مدمر تلقائياً. الأداة الطرفية تحلّ المفاتيح محلياً.',
      ],
    ],
    code: 'local credentials · direct provider calls\nplaybook: a plain file you can read, edit or delete',
    list: [
      [
        'No account database, no server-side password, no email verification.',
        'لا قاعدة حسابات، ولا كلمة مرور على خادم، ولا تحقق عبر البريد.',
      ],
      [
        'Pair codes are held in the app memory and expire after fifteen minutes.',
        'رموز الاقتران تُحفظ في ذاكرة التطبيق وتنتهي بعد خمسة عشر دقيقة.',
      ],
      [
        'Clearing browser storage removes the remembered profile without touching the desktop account.',
        'مسح بيانات المتصفح يزيل الملف المحفوظ دون المساس بحساب التطبيق.',
      ],
    ],
  },
];

function SectionBody({ section }: { section: Section }) {
  const { tx } = useLang();
  return (
    <div className="docs-content">
      {section.paras.map((p, i) => (
        <p className="docs-p" key={`p-${i}`}>{tx(p[0], p[1])}</p>
      ))}

      {section.tags && (
        <div className="docs-tags">
          {section.tags.map((tag) => (
            <span className="fchip" key={tag}>{tag}</span>
          ))}
        </div>
      )}

      {section.code && <CodeReveal code={section.code} />}

      {section.list && (
        <ul className="docs-list">
          {section.list.map((item, i) => (
            <li key={`l-${i}`}>{tx(item[0], item[1])}</li>
          ))}
        </ul>
      )}

      {section.note && (
        <div className="docs-note">
          <span className="label">{tx('NOTE', 'ملاحظة')}</span>
          <span>{tx(section.note[0], section.note[1])}</span>
        </div>
      )}

      {section.cta && (
        <div className="row docs-cta">
          <Link className="btn btn-solid" href="/auth">
            {tx('Open pairing page', 'افتح صفحة الاقتران')} <Link2 size={16} />
          </Link>
          <Link className="btn" href="/download">
            {tx("Don't have the app?", 'ليس لديك التطبيق؟')}
          </Link>
        </div>
      )}
    </div>
  );
}

function DocSection({ section }: { section: Section }) {
  const { tx } = useLang();
  const reduce = useReducedMotion();
  return (
    <motion.section
      id={section.id}
      className="docs-section"
      initial={reduce ? false : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.08 }}
      transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
    >
      <div className="sec-head">
        <div className="sec-index">
          {section.index} / {tx(section.navEn, section.navAr)}
        </div>
        <div className="sec-body">
          <h2 className="h2">{tx(section.titleEn, section.titleAr)}</h2>
          <SectionBody section={section} />
        </div>
      </div>
    </motion.section>
  );
}

export default function DocsPage() {
  const { tx } = useLang();
  const [active, setActive] = useState(SECTIONS[0].id);
  const [progress, setProgress] = useState(0);
  const [seen, setSeen] = useState<string[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-96px 0px -62% 0px', threshold: 0 },
    );
    /* A second, wider observer marks each section we have reached so its
       index number can fill with ink as the page scrolls. */
    const inkObserver = new IntersectionObserver(
      (entries) => {
        const ids = entries.filter((e) => e.isIntersecting).map((e) => e.target.id);
        if (!ids.length) return;
        setSeen((prev) => {
          const next = prev.slice();
          let changed = false;
          ids.forEach((id) => { if (!next.includes(id)) { next.push(id); changed = true; } });
          return changed ? next : prev;
        });
      },
      { rootMargin: '0px 0px -30% 0px', threshold: 0 },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) { observer.observe(el); inkObserver.observe(el); }
    });
    return () => { observer.disconnect(); inkObserver.disconnect(); };
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setProgress(max > 0 ? Math.min(100, (doc.scrollTop / max) * 100) : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <div className="docs-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="wrap docs-page">
        <div className="docs-layout">
          <aside className="docs-index" aria-label={tx('Page index', 'فهرس الصفحة')}>
            <span className="label">{tx('ON THIS PAGE', 'في هذه الصفحة')}</span>
            <nav className="docs-index-nav">
              {SECTIONS.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className={'docs-index-link' + (seen.includes(s.id) ? ' seen' : '') + (active === s.id ? ' active' : '')}
                  onClick={() => setActive(s.id)}
                >
                  <span className="mono"><span>{s.index}</span></span>
                  <span>{tx(s.navEn, s.navAr)}</span>
                </a>
              ))}
            </nav>
            <div className="docs-index-foot">
              <a href={SITE.repo} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={12} /></a>
            </div>
          </aside>

          <div className="docs-main">
            <header className="docs-hero">
              <div className="docs-hero-grid">
                <div className="docs-hero-copy">
                  <span className="label">◆ {tx('DOCUMENTATION / v11.12', 'التوثيق / 11.12')}</span>
                  <h1 className="display" style={{ marginTop: 24 }}>
                    {tx('SADEEM', 'توثيق')}{' '}
                    <span className="accent serif italic">{tx('documentation.', 'سديم.')}</span>
                  </h1>
                  <p className="lead">
                    {tx(
                      'A practical guide to SADEEM v11.12.0: install the desktop app or the CLI, connect a provider key, configure MCP and subagents, and use the living playbook. Read top to bottom or jump to a section.',
                      'دليل عملي لسديم ١١٫١٢٫٠: ثبّت تطبيق سطح المكتب أو الأداة الطرفية، اربط مفتاح مزوّد، اضبط MCP والوكلاء المتخصصين، واستخدم الدليل الحي. اقرأ من البداية أو انتقل إلى أي قسم.',
                    )}
                  </p>
                  <div className="row docs-hero-actions">
                    <Link className="btn btn-solid" href="/download">
                      <Download size={17} />
                      {tx('Download SADEEM', 'حمّل سديم')}
                    </Link>
                    <Link className="btn" href="/auth">
                      {tx('Pair an account', 'اربط حساباً')} <Link2 size={16} />
                    </Link>
                  </div>
                </div>
                <OpenBook />
              </div>
            </header>

            <hr className="rule" />

            {SECTIONS.map((s) => (
              <DocSection section={s} key={s.id} />
            ))}

            <footer className="docs-end">
              <hr className="rule" />
              <div className="row docs-end-row">
                <span className="faint small">{SITE.name} · v{SITE.version} · {tx('Docs', 'الدليل')}</span>
                <div className="row">
                  <a href="#quickstart" className="link">↑ {tx('Back to top', 'العودة للأعلى')}</a>
                  <Link href="/download" className="link">{tx('Download', 'التحميل')}</Link>
                  <Link href="/auth" className="link">{tx('Pair', 'الاقتران')}</Link>
                </div>
              </div>
            </footer>
          </div>
        </div>
      </div>
    </>
  );
}
