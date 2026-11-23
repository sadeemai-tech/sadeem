'use client';

import Link from 'next/link';
import { useReducedMotion } from 'framer-motion';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Bot,
  CalendarCheck2,
  Code2,
  GitBranch,
  Plug,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { InkReveal } from '@/components/visuals/InkReveal';
import { useLang } from '@/lib/i18n';
import { SITE } from '@/lib/site';
import './features.css';

type Row = {
  icon: ReactNode;
  en: [string, string];
  ar: [string, string];
  chips: string[];
};

type DiagramKind = 'bloom' | 'thinking' | 'memory' | 'keys';

type Group = {
  id: string;
  navEn: string;
  navAr: string;
  titleEn: string;
  titleAr: string;
  leadEn: string;
  leadAr: string;
  diagram?: DiagramKind;
  rows: Row[];
};

/* Eight small ink glyphs — one per section. Shared grammar: a 24px grid,
   one 1px stroke, nodes as dots, no fills, no rounded corners. The `kind`
   is only a hook for the shared art-motion layer: a single concept per
   glyph (the network node breathes, the shield draws once, ...). */
const glyph = (kind: string, children: ReactNode) => (
  <svg className={`glyph-svg am-glyph am-glyph--${kind}`} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const gdot = (x: number, y: number, r = 1.4, key?: number) =>
  <circle key={key} cx={x} cy={y} r={r} fill="currentColor" stroke="none" />;
const spokes = (cx: number, cy: number, r: number, count: number) =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return `M${(cx + Math.cos(a) * 3.5).toFixed(1)} ${(cy + Math.sin(a) * 3.5).toFixed(1)}L${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
  }).join('');
const spokeEnds = (cx: number, cy: number, r: number, count: number) =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return gdot(+(cx + Math.cos(a) * r).toFixed(1), +(cy + Math.sin(a) * r).toFixed(1), 1.2, i);
  });
const GLYPHS: Record<string, ReactNode> = {
  tools: glyph('tools', <><path d="M12 20V10M12 10 7 5M12 10l5-5" />{gdot(7, 5)}{gdot(17, 5)}{gdot(12, 20, 1.2)}</>),
  mcp: glyph('mcp', <><path d={spokes(12, 12, 9, 6)} /><circle className="am-node-pulse" cx="12" cy="12" r="3.5" />{spokeEnds(12, 12, 9, 6)}</>),
  subagents: glyph('subagents', <><path d="M12 5v4M12 9 6 19m6-10v10m0-10 6 10" /><circle className="am-node-pulse" cx="12" cy="4" r="2" fill="currentColor" stroke="none" />{gdot(6, 20, 2)}{gdot(12, 20, 2)}{gdot(18, 20, 2)}</>),
  playbook: glyph('playbook', <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path className="am-draw" pathLength={1} d="M9.3 12l1.9 1.9 3.7-4.1" /></>),
  worktrees: glyph('worktrees', <><path d="M4 12h6M10 12 16 6M10 12l6 6" />{gdot(4, 12)}{gdot(16, 6)}{gdot(16, 18)}</>),
  workflow: glyph('workflow', <><path d="M5 6v12M9 6h11M9 12h11M9 18h11" />{gdot(5, 6, 1.2)}{gdot(5, 12, 1.2)}{gdot(5, 18, 1.2)}</>),
  editor: glyph('editor', <><path d="M9 5 4 12l5 7m6-14 5 7-5 7" />{gdot(12, 12, 1.3)}</>),
  privacy: glyph('privacy', <><path className="am-draw" pathLength={1} d="M12 3 20 6v6c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V6z" />{gdot(12, 12, 1.4)}</>),
};

const GROUPS: Group[] = [
  {
    id: 'tools',
    navEn: 'Tools', navAr: 'الأدوات',
    titleEn: 'Read, edit and run', titleAr: 'اقرأ، عدّل، شغّل',
    leadEn: '145 tools. Each has a name, a JSON schema and a routing description, and dispatches to a real executor. Profiles change the menu for one turn — never what may be called by name.',
    leadAr: '١٤٥ أداة. لكل منها اسم ومخطط JSON ووصف توجيهي، وتُرسل إلى منفّذ حقيقي. تغيّر ملفات الأدوات ما يراه النموذج في دورة واحدة، لا ما يمكن استدعاؤه باسمه.',
    diagram: 'bloom',
    rows: [
      {
        icon: <Wrench size={18} strokeWidth={1.6} />,
        en: ['Map the workspace before editing', 'list_dir, read_file, search_files, workspace_map, find_refs and impact_of map files, symbols, call sites and blast radius before the agent changes anything.'],
        ar: ['افهم المشروع قبل التعديل', 'list_dir وread_file وsearch_files وworkspace_map وfind_refs وimpact_of تعرض الملفات والرموز ومواقع الاستدعاء ونطاق التأثير قبل أي تعديل.'],
        chips: ['list_dir', 'read_file', 'search_files', 'workspace_map', 'find_refs', 'impact_of'],
      },
      {
        icon: <Terminal size={18} strokeWidth={1.6} />,
        en: ['Write files and run commands', 'write_file and multi_edit apply changes through the approval gate. run_command captures output and exit codes; run_background, process_output and stop_process keep dev servers and watchers under control.'],
        ar: ['اكتب الملفات وشغّل الأوامر', 'write_file وmulti_edit يطبّقان التغييرات عبر بوابة الموافقة. run_command يسجّل المخرجات ورموز الخروج، وrun_background وprocess_output وstop_process يتحكمان بخوادم التطوير والمراقبين.'],
        chips: ['write_file', 'multi_edit', 'run_command', 'run_background', 'stop_process'],
      },
      {
        icon: <Code2 size={18} strokeWidth={1.6} />,
        en: ['Build real artifacts', 'make_document writes PDF, DOCX and XLSX files; Arabic text gets correct RTL shaping. image_generate saves an image into the workspace with no image API key, but needs network access. PPTX and ffmpeg operations need local tools installed.'],
        ar: ['أنتج ملفات فعلية', 'تكتب make_document ملفات PDF وDOCX وXLSX، ويحصل النص العربي على تشكيل RTL صحيح. وتحفظ image_generate صورة في مساحة العمل بلا مفتاح صور، لكنها تحتاج اتصالاً بالشبكة. أما PPTX وffmpeg فتحتاجان أدوات محلية مثبتة.'],
        chips: ['make_document', 'pdf_make', 'xlsx_make', 'image_generate', 'archive_create'],
      },
      {
        icon: <Wrench size={18} strokeWidth={1.6} />,
        en: ['Query data, run QA', 'sqlite_query, db_query, csv_read and db_migrate work on local data. test_run, lint_check, lighthouse, a11y_audit and ui_quality_check return captured results. External QA tools must be installed in the workspace.'],
        ar: ['استعلم عن البيانات وشغّل الجودة', 'sqlite_query وdb_query وcsv_read وdb_migrate تعمل على بيانات محلية. test_run وlint_check وlighthouse وa11y_audit وui_quality_check تعيد نتائج مسجّلة. أدوات الجودة الخارجية يجب تثبيتها في مساحة العمل.'],
        chips: ['sqlite_query', 'db_query', 'test_run', 'lint_check', 'a11y_audit'],
      },
    ],
  },
  {
    id: 'mcp',
    navEn: 'MCP', navAr: 'الخوادم الخارجية',
    titleEn: 'MCP servers', titleAr: 'سيرفرات MCP',
    leadEn: 'Connect external tools over stdio, streamable HTTP or SSE. The client negotiates the protocol revision, follows paginated tool lists and reuses a live connection across calls. Descriptions are scanned for poisoning before a server is enabled.',
    leadAr: 'اربط أدوات خارجية عبر stdio أو HTTP المتدفق أو SSE. يفاوض العميل إصدار البروتوكول، ويتتبع قوائم الأدوات المجزّأة، ويعيد استخدام الاتصال الحي بين النداءات. وتُفحص الأوصاف بحثاً عن التسميم قبل تفعيل السيرفر.',
    rows: [
      {
        icon: <Plug size={18} strokeWidth={1.6} />,
        en: ['Add a server with a command', 'In Settings → Servers → Add server, enter a name, a command and its arguments, press Test, then enable it. Connected tools get full definitions in the tool registry.'],
        ar: ['أضف خادماً بأمر', 'افتح الإعدادات ← الخوادم ← إضافة خادم، أدخل الاسم والأمر ووسائطه، اضغط اختبار ثم فعّله. الأدوات المتصلة تحصل على تعريفات كاملة في سجل الأدوات.'],
        chips: ['stdio', 'http', 'sse', 'tools/list'],
      },
      {
        icon: <ShieldCheck size={18} strokeWidth={1.6} />,
        en: ['Review what a server can do', 'Descriptions are scanned for tool poisoning. Servers can be quarantined, single tools disabled, and definitions hash-pinned so a changed description needs re-approval. Destructive calls go through the approval gate.'],
        ar: ['راجع ما يمكن للخادم فعله', 'تفحص الأوصاف بحثاً عن تسميم الأدوات. يمكن حظر الخادم، وتعطيل أداة بمفردها، وتثبيت بصمة التعريف حتى يتطلب أي تغيير موافقة جديدة. النداءات المدمرة تمر عبر بوابة الموافقة.'],
        chips: ['quarantine', 'tool annotations', 'hash pin', 'approval'],
      },
      {
        icon: <Sparkles size={18} strokeWidth={1.6} />,
        en: ['Available in every profile', 'Tools from connected servers keep their full definitions in every tool profile. A profile changes what the model is advertised, not what is callable.'],
        ar: ['متاحة في كل ملف أدوات', 'أدوات الخوادم المتصلة تحتفظ بتعريفاتها الكاملة في كل ملف أدوات. الملف يغيّر ما يُعرض للنموذج، لا ما يمكن استدعاؤه.'],
        chips: ['external tools', 'all profiles', 'destructive calls'],
      },
    ],
  },
  {
    id: 'subagents',
    navEn: 'Subagents', navAr: 'الوكلاء الفرعيون',
    titleEn: 'Specialist subagents', titleAr: 'وكلاء متخصصون',
    leadEn: 'Sixteen specialists run their own loop with the full tool registry. They differ by role — explorer, debugger, security auditor — not by capability. Parallel children are launched together; one hung child never stalls the others.',
    leadAr: 'ستة عشر وكيلاً متخصصاً يشغّل كل منهم حلقة كاملة بسجل الأدوات الكامل. يختلفون بالدور — مستكشف، مصحح، مدقق أمني — لا بالقدرة. يُطلق العملاء المتوازيون معاً، ولا يعلّق طفل معطل الآخرين.',
    diagram: 'thinking',
    rows: [
      {
        icon: <Bot size={18} strokeWidth={1.6} />,
        en: ['Call a specialist by id', 'Use the task tool with a specialist id and a complete prompt; a child cannot chat with the user. Background children report through completion messages, and approvals pass through the parent gate.'],
        ar: ['استدعِ متخصصاً بمعرّفه', 'استخدم أداة task مع معرّف المتخصص وتوجيه كامل؛ فالوكيل الفرعي لا يستطيع محادثة المستخدم. يُبلّغ العمل في الخلفية برسائل الاكتمال، وتمر الموافقات عبر بوابة الوكيل الرئيسي.'],
        chips: ['task', 'background', 'explore', 'debugger', 'security'],
      },
      {
        icon: <Code2 size={18} strokeWidth={1.6} />,
        en: ['Roles across the loop', 'Research maps code with file:line references or cross-checks web sources; build makes minimal diffs; quality reproduces bugs, measures performance and audits security; ops verifies builds and writes docs.'],
        ar: ['أدوار في جميع مراحل العمل', 'البحث يرسم خريطة الكود بمراجع file:line أو يتحقق من مصادر الويب؛ والبناء ينتج فروقاً صغيرة؛ والجودة يعيد إنتاج الأخطاء ويقيس الأداء ويدقق الأمان؛ والعمليات تتحقق من البنى وتكتب التوثيق.'],
        chips: ['spec', 'implement', 'perf', 'review', 'devops', 'docs'],
      },
    ],
  },
  {
    id: 'playbook',
    navEn: 'Playbook', navAr: 'الدليل الحي',
    titleEn: 'Living Playbook', titleAr: 'الدليل الحي',
    leadEn: 'A markdown file in the workspace. After a run the app writes what worked, what failed, your preferences and verified recipes into PLAYBOOK.md; the next run reads it as advice.',
    leadAr: 'ملف Markdown داخل مساحة العمل. بعد كل مهمة يكتب التطبيق ما نجح وما فشل وتفضيلاتك والوصفات المؤكدة في PLAYBOOK.md، وتقرأه المهمة التالية كتوجيه.',
    diagram: 'memory',
    rows: [
      {
        icon: <Sparkles size={18} strokeWidth={1.6} />,
        en: ['What the file records', 'A no-tools extraction after a completed run merges worked, failed, preferences and recipes into PLAYBOOK.md, increments a count when a lesson repeats, and keeps a version history with per-revision diffs.'],
        ar: ['ما الذي يسجّله الملف', 'بعد اكتمال المهمة يدمج استخراج بلا أدوات ما نجح وما فشل والتفضيلات والوصفات في PLAYBOOK.md، ويزيد عدّاد الدرس عند تكراره، ويحتفظ بسجل إصدارات مع فروق كل مراجعة.'],
        chips: ['worked', 'failed', 'preferences', 'recipes', 'PLAYBOOK.md'],
      },
      {
        icon: <GitBranch size={18} strokeWidth={1.6} />,
        en: ['Advisory, visible, reversible', 'The current playbook is injected as advice; the current request always overrides it and learned facts never become bans. The interface shows an evolution timeline with per-revision diffs.'],
        ar: ['توجيهي، مرئي، قابل للتراجع', 'يُحقن الدليل الحالي كتوجيه؛ والطلب الحالي يتقدّم عليه دائماً، ولا تتحول الحقائق المتعلّمة إلى قيود. تعرض الواجهة خطاً زمنياً للتطور مع فروق كل مراجعة.'],
        chips: ['advisory', 'timeline', 'editable'],
      },
      {
        icon: <Sparkles size={18} strokeWidth={1.6} />,
        en: ['See what was learned', 'The DNA Insights lens explains each stored fact: its confidence, repetition count, the rule behind it and whether it reaches the next prompt. When the active window fills, the oldest well-learned fact retires so a new one is never dropped. Facts stay advice; the current request overrides them.'],
        ar: ['شاهد ما تعلّمه', 'تشرح عدسة «رؤى الحمض» كل حقيقة مخزّنة: ثقتها وعدد تكراراتها والقاعدة التي أنشأتها وما إذا كانت ستصل إلى التوجيه التالي. وعند امتلاء النافذة يُقاعد أقدم معلومة تعلّمها جيداً كي لا تُسقط معلومة جديدة. تبقى الحقائق توجيهاً ويتقدّم عليها طلبك الحالي.'],
        chips: ['DNA Insights', 'advisory', 'lossless'],
      },
      {
        icon: <Bot size={18} strokeWidth={1.6} />,
        en: ['Recall an old decision', 'Ask why a choice was made and recall_memory returns the real excerpt and session title from past sessions — not a summary the model invented.'],
        ar: ['استعد قراراً قديماً', 'اسأل عن سبب اختيار سابق فيُعيد recall_memory المقطع الحقيقي وعنوان الجلسة من الجلسات السابقة — لا ملخّصاً اخترعه النموذج.'],
        chips: ['recall_memory', 'real excerpts', 'sessions'],
      },
    ],
  },
  {
    id: 'worktrees',
    navEn: 'Worktrees', navAr: 'مساعات العمل',
    titleEn: 'Worktrees & checkpoints', titleAr: 'مساعات العمل ونقاط الحفظ',
    leadEn: 'Create isolated git worktrees for parallel work, save named full-file checkpoints before a refactor, and restore them when an experiment fails.',
    leadAr: 'أنشئ مساعات عمل git معزولة للعمل المتوازي، واحفظ لقطات كاملة للملفات بأسماء قبل إعادة الهيكلة، واستعدها عندما تفشل التجربة.',
    rows: [
      {
        icon: <GitBranch size={18} strokeWidth={1.6} />,
        en: ['Isolation in a single call', 'A create call adds a sibling worktree on a dedicated branch; removal cleans it up. Ignored files listed in the include file are copied in, and uncommitted changes are never silently carried over.'],
        ar: ['عزل باستدعاء واحد', 'ينشئ الاستدعاء مساعة مجاورة على فرع مخصص ويزيلها استدعاء الحذف. تُنسخ الملفات المتجاهلة المدرجة في ملف التضمين، ولا تُنقل التغييرات غير الملتزمة تلقائياً.'],
        chips: ['worktree_create', 'worktree_remove', 'diff_stat'],
      },
      {
        icon: <ShieldCheck size={18} strokeWidth={1.6} />,
        en: ['Shadow-commit before risk', 'Before an allowed write the engine takes a git shadow-commit on a dedicated ref. Your index, working tree and stash stay untouched. /undo restores the files and the conversation together; non-git folders fall back to file copies.'],
        ar: ['نسخة shadow-commit قبل المخاطرة', 'قبل الكتابة المسموح بها يأخذ المحرك نسخة shadow-commit على مرجع مخصص. يبقى الفهرس ومجلد العمل والـstash دون تغيير. ويُرجع /undo الملفات والمحادثة معاً؛ والمجلدات غير التابعة لـgit تستخدم نسخاً من الملفات.'],
        chips: ['checkpoint_save', 'checkpoint_restore', 'undo', 'diff_stat'],
      },
    ],
  },
  {
    id: 'workflow',
    navEn: 'Workflow', navAr: 'سير العمل',
    titleEn: 'Plans, skills & schedules', titleAr: 'خطط ومهارات وجدولة',
    leadEn: 'Approve a plan before edits, save a procedure once and load it in any session, or put recurring work on a cron that runs the same engine and requires the workspace tests to pass.',
    leadAr: 'وافق على خطة قبل التعديل، واحفظ إجراءً مرة واحدة وحمّله في أي جلسة، أو ضع عملاً متكرراً على جدول دوري يشغّل المحرك نفسه ويشترط نجاح اختبارات المساحة.',
    rows: [
      {
        icon: <CalendarCheck2 size={18} strokeWidth={1.6} />,
        en: ['Plan approval first', 'propose_plan submits steps and risks for an approve or revise dialog. Permission modes are plan, default, autoEdit and fullAccess; plan and review keep the run read-only.'],
        ar: ['الموافقة على الخطة أولاً', 'propose_plan يقدّم الخطوات والمخاطر إلى نافذة موافقة أو تعديل. أوضاع الصلاحية هي plan وdefault وautoEdit وfullAccess؛ ووضع plan يبقي التشغيل للقراءة فقط.'],
        chips: ['propose_plan', 'approve', 'revise', 'plan'],
      },
      {
        icon: <Sparkles size={18} strokeWidth={1.6} />,
        en: ['Skills that survive sessions', 'Save a procedure once at workspace or global scope and load it by slug with use_skill. A completed goal can also distill the transcript into a reusable skill.'],
        ar: ['مهارات تعبر الجلسات', 'احفظ إجراءً مرة واحدة على مستوى مساحة العمل أو العام وحمّله بمعرّفه عبر use_skill. كما يمكن لهدف مكتمل أن يقطّر المحادثة إلى مهارة قابلة لإعادة الاستخدام.'],
        chips: ['use_skill', 'create_skill', 'workspace', 'global'],
      },
      {
        icon: <CalendarCheck2 size={18} strokeWidth={1.6} />,
        en: ['Cron jobs with a test gate', 'A schedule fires the same agent engine headlessly. If the workspace test suite fails after the run, the result is suppressed; every fire lands in a durable ledger with the exact next-run time, error count and duration.'],
        ar: ['مهام دورية ببوابة اختبار', 'المهمة المجدولة تشغّل محرك الوكيل نفسه بلا واجهة. إذا فشلت اختبارات المساحة بعد التشغيل لا يُعرض النتيجة؛ وكل تشغيل يُسجّل في سجل دائم بموعده التالي الدقيق وعدد الأخطاء والمدة.'],
        chips: ['/schedule', 'cron', 'test_run', 'events'],
      },
      {
        icon: <Wrench size={18} strokeWidth={1.6} />,
        en: ['Correct it while it works', 'Send a message mid-task: it lands at the next tool boundary with a visible note that you sent it while the agent was working. No restart, no lost progress.'],
        ar: ['صحّحه أثناء العمل', 'أرسل رسالة أثناء المهمة: تصل عند الحد التالي بين الأدوات مع بيان أنك أرسلتها والوكيل يعمل. بلا إعادة تشغيل ولا فقدان تقدّم.'],
        chips: ['steer', 'queue', 'tool boundary'],
      },
      {
        icon: <ShieldCheck size={18} strokeWidth={1.6} />,
        en: ['Proof you can re-run', 'Real changes produce a signed proof package. The verify command checks the signature with no key, re-checks file fingerprints and re-runs the recorded test command. It proves the record is authentic, not that the code is correct.'],
        ar: ['إثبات يمكنك إعادة تشغيله', 'كل تغيير حقيقي يُنتج حزمة إثبات موقّعة. يتحقق أمر التحقق من التوقيع بلا مفتاح، ويعيد فحص بصمات الملفات وتشغيل أمر الاختبار المسجّل. يثبت ذلك أصالة السجل لا صحة الكود.'],
        chips: ['proof_package', 'verify', 'rerun'],
      },
    ],
  },
  {
    id: 'editor',
    navEn: 'Editor', navAr: 'المحرر',
    titleEn: 'Code intelligence & debugging', titleAr: 'ذكاء الكود والتصحيح',
    leadEn: 'Definition, diagnostics, references and renames come from language servers; breakpoints and stepping from a DAP debugger. A missing server returns the exact install command, and heuristic fallbacks are labelled as such.',
    leadAr: 'الانتقال إلى التعريف والتشخيصات والمراجع وإعادة التسمية تأتي من خوادم لغات حقيقية، ونقاط التوقف والتخطي من مصحح DAP. وعند غياب الخادم يُعيد الأداة أمر التثبيت الدقيق، وتُوسَم النتائج التقديرية بأنها تقديرية.',
    rows: [
      {
        icon: <Code2 size={18} strokeWidth={1.6} />,
        en: ['Language servers, not heuristics', 'Go-to-definition, hover documentation, diagnostics, all-references and computed renames come from real language servers. When no server is installed, the tool says so instead of inventing an answer.'],
        ar: ['خوادم لغات، لا تخمينات', 'الانتقال إلى التعريف وتوثيق التحويم والتشخيصات وكل المراجع وإعادة التسمية المحسوبة تأتي من خوادم لغات حقيقية. وعند غياب الخادم تقول الأداة ذلك بدل اختلاق إجابة.'],
        chips: ['lsp_definition', 'lsp_hover', 'lsp_diagnostics', 'lsp_rename', 'lsp_completion'],
      },
      {
        icon: <Terminal size={18} strokeWidth={1.6} />,
        en: ['A real debugger', 'Attach over DAP, set breakpoints, inspect live variables, evaluate expressions and step through code. Stopping returns a root-cause evidence trail attached to the run proof.'],
        ar: ['مصحح أخطاء حقيقي', 'اتصل عبر بروتوكول تصحيح التطبيقات، ضع نقاط توقف، افحص المتغيرات الحية، قيّم التعبيرات وتخطّ الكود. والإيقاف يُعيد سلسلة أدلة السبب الجذري الملحقة بإثبات المهمة.'],
        chips: ['debug_start', 'debug_state', 'debug_eval', 'debug_step', 'debug_stop'],
      },
      {
        icon: <ShieldCheck size={18} strokeWidth={1.6} />,
        en: ['Checks before a report', 'The harness audits claims against files, commands and tests; a verifier from another model family re-checks with read-only commands, and failed calls are reported as errors. The gates check evidence; they cannot guarantee the model’s answer is wise.'],
        ar: ['فحوص قبل التقرير', 'تتحقق المنصّة من الادعاءات مقابل الملفات والأوامر والاختبارات، ويعيد مدقّق من عائلة نموذج أخرى الفحص بأوامر للقراءة فقط، وتُعدّ النداءات الفاشلة أخطاءً. البوابات تفحص الأدلة، ولا تضمن حكمة إجابة النموذج.'],
        chips: ['test_run', 'lint_check', 'review_diff', 'cross-family verifier'],
      },
      {
        icon: <Code2 size={18} strokeWidth={1.6} />,
        en: ['It looks at what it built', 'The agent captures a screenshot of the rendered page and a vision model reads it. A deterministic probe then checks overflow, contrast, tiny text and console errors before the UI is called done. Headless runs skip the visual probe and say so.'],
        ar: ['ينظر إلى ما بناه', 'يصوّر الوكيل الصفحة المعروضة ويقرأ نموذج الرؤية الصورة. ثم يفحص فاحص آلي التجاوز والتباين والنصوص الصغيرة وأخطاء الوحدة الطرفية قبل إعلان اكتمال الواجهة. والتشغيلات بلا واجهة تتخطى الفحص البصري وتقول ذلك.'],
        chips: ['preview_screenshot', 'vision', 'ui_quality_check'],
      },
    ],
  },
  {
    id: 'privacy',
    navEn: 'Privacy', navAr: 'الخصوصية',
    titleEn: 'Keys and files stay local', titleAr: 'مفاتيحك وملفاتك على جهازك',
    leadEn: 'Credentials are stored locally and provider calls go straight to the provider you chose. Learning files are plain markdown and JSON on your machine. Dangerous commands wait for approval.',
    leadAr: 'تُخزّن بيانات الاعتماد محلياً وتنطلق نداءات المزوّد مباشرة إلى المزوّد الذي اخترته. ملفات التعلّم Markdown وJSON على جهازك. الأوامر الخطرة تنتظر الموافقة.',
    diagram: 'keys',
    rows: [
      {
        icon: <ShieldCheck size={18} strokeWidth={1.6} />,
        en: ['Your keys, your machine', 'Credentials stay in local settings; the provider you chose bills you directly. The playbook is a plain markdown file you can read, edit or delete.'],
        ar: ['مفاتيحك على جهازك', 'تبقى بيانات الاعتماد في إعدادات محلية، ومزوّدك يفاترك مباشرة. الدليل الحيّ ملف Markdown عادي تقرأه وتعدّله وتحذفه.'],
        chips: ['BYOK', 'direct calls', 'PLAYBOOK.md'],
      },
      {
        icon: <Terminal size={18} strokeWidth={1.6} />,
        en: ['Gates where they matter', 'Danger-classified shell commands wait for approval. Plan and review modes deny writes. Text fetched from a page, an MCP server or a repo README is marked with its origin; a hostile instruction cannot push an install or destructive command through, even in full access.'],
        ar: ['بوابات حيث تهم', 'أوامر الصدفة المصنفة خطرة تنتظر الموافقة، ووضعا plan وreview يمنعان الكتابة. يُوسَم النص القادم من صفحة أو سيرفر MCP أو ملف README بمصدره؛ ولا تستطيع تعليمات ضارة دفع أمر تثبيت أو أمر مدمر حتى في وضع الوصول الكامل.'],
        chips: ['approval', 'taint', 'read-only', 'deny'],
      },
      {
        icon: <Code2 size={18} strokeWidth={1.6} />,
        en: ['See the real context cost', 'The context ring uses the last turn’s real token delta and marks provider estimates with ≈. Deep effort is a real engine change: it doubles the step budget, not a badge.'],
        ar: ['شاهد التكلفة الحقيقية للسياق', 'تستخدم حلقة السياق الفرق الحقيقي لآخر دورة وتُعلّم تقديرات المزوّد بـ≈. والتفكير العميق تغيير فعلي في المحرك: يضاعف ميزانية الخطوات، ليس مجرد شارة.'],
        chips: ['Context Lens', '≈', 'deep effort'],
      },
    ],
  },
];

const STATS: [string, string, string][] = [
  ['145', 'TOOLS', 'أداة'],
  ['12', 'PROVIDERS', 'مزوّد'],
  ['MCP', 'BRING YOUR SERVERS', 'أضف سيرفراتك'],
  ['16', 'SPECIALIST AGENTS', 'وكيل متخصص'],
  ['BYOK', 'KEYS STAY ON YOUR MACHINE', 'مفاتيحك تبقى على جهازك'],
];

const TERM = `$ sadeem version
SADEEM ${SITE.version} · local-first coding agent · same engine as the desktop app

› profiles   view only       # balanced is default; strong models see all 145
› tools      145 tools       # external-server tools stay in every view
› playbook   PLAYBOOK.md     advisory · versioned · editable

› task("audit the auth module and propose minimal fixes")
  → specialist subagent · background · summary on completion`;

type Tool = { name: string; result: string };
const TOOL_CYCLE: Tool[] = [
  { name: 'read_file', result: 'ok' },
  { name: 'run_command', result: 'exit 0' },
  { name: 'lsp_definition', result: 'ok' },
  { name: 'worktree_create', result: 'ok' },
  { name: 'lighthouse', result: 'ok' },
  { name: 'a11y_audit', result: 'ok' },
  { name: 'db_query', result: 'ok' },
  { name: 'multi_file_edit', result: 'ok' },
];

/* ------------------------------------------------------------------
   PLATE FURNITURE — hairline geometry shared by every crafted plate.
   ------------------------------------------------------------------ */
function Crosshairs() {
  return <span className="crosshairs" aria-hidden="true"><i /><i /><i /><i /></span>;
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}

function Plate({
  n, labelEn, labelAr, noteEn, noteAr, className = '', children,
}: {
  n: string;
  labelEn: string;
  labelAr: string;
  noteEn: string;
  noteAr: string;
  className?: string;
  children: ReactNode;
}) {
  const { tx } = useLang();
  return (
    <InkReveal as="figure" className={`fp-plate ${className}`} index={0}>
      <Crosshairs />
      <div className="fp-plate-head">
        <span className="label">{'PLATE ' + n + ' / ' + tx(labelEn, labelAr)}</span>
        <span className="label">{tx(noteEn, noteAr)}</span>
      </div>
      <div className="fp-plate-stage">{children}</div>
      <hr className="rule-art fp-draw" />
      <figcaption className="fp-plate-cap">
        <span className="mono">FIG. {n} · SADEEM / v{SITE.version}</span>
        <span className="mono">{tx('HAIRLINE GEOMETRY · 1PX', 'هندسة خطية · ١ بكسل')}</span>
      </figcaption>
    </InkReveal>
  );
}

/* ------------------------------------------------------------------
   PLATE 01 — anatomy of an agent (the hero centerpiece).
   ------------------------------------------------------------------ */
type AnatomyNode = { id: string; en: string; ar: string; tool: string; a: number };
const ANATOMY_NODES: AnatomyNode[] = [
  { id: 'files', en: 'FILES', ar: 'الملفات', tool: 'read_file', a: -90 },
  { id: 'shell', en: 'COMMANDS', ar: 'الأوامر', tool: 'run_command', a: -18 },
  { id: 'code', en: 'CODE INTEL', ar: 'ذكاء الكود', tool: 'lsp_definition', a: 54 },
  { id: 'web', en: 'WEB', ar: 'الويب', tool: 'web_search', a: 126 },
  { id: 'media', en: 'MEDIA', ar: 'الوسائط', tool: 'preview', a: 198 },
];

function AnatomyDiagram() {
  const { tx } = useLang();
  const L = (s: string) => tx(s, s);
  const cx = 250, cy = 250, R = 148;
  const p = (r: number, a: number) =>
    [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  return (
    <div className="anatomy-wrap">
      <Crosshairs />
      <svg className="anatomy-svg" viewBox="0 0 500 500" aria-hidden="true">
        <g className="anatomy-orbits" fill="none" stroke="currentColor">
          <circle cx={cx} cy={cy} r="84" strokeWidth=".7" opacity=".26" />
          <circle cx={cx} cy={cy} r={R} strokeWidth=".7" opacity=".22" />
          <circle cx={cx} cy={cy} r="200" strokeWidth=".6" opacity=".16" />
        </g>
        <g className="anatomy-rotor" fill="none" stroke="currentColor" opacity=".5">
          <circle cx={cx} cy={cy} r="84" strokeWidth=".7" strokeDasharray="2 14" />
          <circle cx={cx + 84} cy={cy} r="2.4" fill="currentColor" stroke="none" />
        </g>
        <g className="anatomy-rotor anatomy-rotor-rev" fill="none" stroke="currentColor" opacity=".4">
          <circle cx={cx} cy={cy} r={R} strokeWidth=".7" strokeDasharray="8 26" />
          <circle cx={cx} cy={cy} r="200" strokeWidth=".6" strokeDasharray="1 20" />
          <circle cx={cx - R} cy={cy} r="2" fill="currentColor" stroke="none" />
        </g>
        <circle className="anatomy-pulse" cx={cx} cy={cy} r="30" fill="none" stroke="currentColor" />
        <circle cx={cx} cy={cy} r="22" fill="var(--accent-fill)" stroke="none" />
        <g className="anatomy-core-texture" fill="none" stroke="currentColor" opacity=".42">
          {[19, 14, 9].map((r) => <circle key={r} cx={cx} cy={cy} r={r} strokeWidth=".5" />)}
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2;
            const [x1, y1] = p(19, a);
            const [x2, y2] = p(22, a);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth=".5" />;
          })}
        </g>
        <circle cx={cx} cy={cy} r="4.5" fill="var(--bg)" stroke="currentColor" strokeWidth=".5" />
        {ANATOMY_NODES.map((n) => {
          const rad = (n.a * Math.PI) / 180;
          const [x, y] = p(R, rad);
          const [lx, ly] = p(R + 18, rad);
          const right = Math.cos(rad) >= 0;
          const ex = lx + (right ? 12 : -12);
          return (
            <g key={n.id}>
              <path d={`M${x.toFixed(1)} ${y.toFixed(1)}L${lx.toFixed(1)} ${ly.toFixed(1)}L${ex.toFixed(1)} ${ly.toFixed(1)}`}
                fill="none" stroke="currentColor" strokeWidth=".7" opacity=".55" />
              <circle cx={lx} cy={ly} r="1.5" fill="currentColor" stroke="none" opacity=".7" />
              <circle className="anatomy-node" cx={x} cy={y} r="4" fill="currentColor" />
              <text x={ex + (right ? 4 : -4)} y={ly + 3}
                textAnchor={right ? 'start' : 'end'} className="anatomy-label">{tx(n.en, n.ar)}</text>
              <text x={ex + (right ? 4 : -4)} y={ly + 15}
                textAnchor={right ? 'start' : 'end'} className="anatomy-sub">{L(n.tool)}</text>
            </g>
          );
        })}
      </svg>
      <div className="anatomy-cap">
        <span className="label">{tx('PLATE 01 / ANATOMY OF AN AGENT', 'اللوحة ٠١ / تشريح الوكيل')}</span>
        <span className="label">{tx('FIVE TOOL FAMILIES · ONE CORE', 'خمس عائلات أدوات · نواة واحدة')}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   PLATE 02 — TOOL BLOOM. Eight real tool families open from one core.
   Scroll arms the staggered bloom; hover nudges each spoke outward.
   Only transform + opacity are animated.
   ------------------------------------------------------------------ */
const BLOOM_TOOLS = [
  { en: 'FILES', ar: 'الملفات', tool: 'read_file' },
  { en: 'COMMANDS', ar: 'الأوامر', tool: 'run_command' },
  { en: 'CODE', ar: 'الكود', tool: 'lsp_definition' },
  { en: 'WEB', ar: 'الويب', tool: 'web_search' },
  { en: 'MEDIA', ar: 'الوسائط', tool: 'preview' },
  { en: 'DATA', ar: 'البيانات', tool: 'db_query' },
  { en: 'UI', ar: 'الواجهة', tool: 'ui_quality_check' },
  { en: 'GIT', ar: 'جيت', tool: 'worktree_create' },
];

function ToolBloom() {
  const { tx } = useLang();
  const cx = 220, cy = 210, R = 104;
  return (
    <svg viewBox="0 0 440 420" className="fp-svg" aria-hidden="true">
      <g fill="none" stroke="currentColor">
        {[46, R, 158].map((r) => <circle key={r} cx={cx} cy={cy} r={r} strokeWidth=".7" opacity=".17" />)}
        <circle className="fp-bloom-sweep" cx={cx} cy={cy} r={R} strokeWidth=".7" strokeDasharray="2 10" opacity=".42" />
        <path d={`M${cx - 172} ${cy}h344M${cx} ${cy - 172}v344`} strokeWidth=".5" opacity=".1" />
      </g>
      <g className="fp-bloom-core">
        <circle cx={cx} cy={cy} r="27" fill="var(--accent-fill)" stroke="none" opacity=".14" />
        <circle cx={cx} cy={cy} r="20" fill="none" stroke="currentColor" strokeWidth=".7" />
        <circle cx={cx} cy={cy} r="12" fill="none" stroke="currentColor" strokeWidth=".5" strokeDasharray="2 4" opacity=".5" />
        <circle className="fp-core-dot" cx={cx} cy={cy} r="4" fill="var(--accent)" stroke="none" />
      </g>
      {BLOOM_TOOLS.map((tool, i) => {
        const deg = -90 + i * 45;
        const p1 = polar(cx, cy, 30, deg);
        const p2 = polar(cx, cy, R - 7, deg);
        const node = polar(cx, cy, R, deg);
        const lab = polar(cx, cy, R + 22, deg);
        const right = Math.cos((deg * Math.PI) / 180) >= 0;
        const style = {
          '--i': i,
          '--dx': node.x - cx,
          '--dy': node.y - cy,
        } as CSSProperties;
        return (
          <g className="fp-spoke" style={style} key={tool.tool}>
            <g className="fp-spoke-in">
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="currentColor" strokeWidth=".7" opacity=".5" />
              <rect x={node.x - 3.5} y={node.y - 3.5} width="7" height="7" fill="var(--paper)" stroke="currentColor" strokeWidth=".8" />
              <circle cx={node.x} cy={node.y} r="1.2" fill="var(--accent)" stroke="none" />
              <text x={lab.x} y={lab.y + 3} textAnchor={right ? 'start' : 'end'} className="fp-sp-label">{tx(tool.en, tool.ar)}</text>
              <text x={lab.x} y={lab.y + 14} textAnchor={right ? 'start' : 'end'} className="fp-sp-tool">{tool.tool}</text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------
   PLATE 03 — THINKING CIRCLE. The observe → plan → act → verify loop
   with an orbiting marker. Scroll stages the nodes; hover lifts the ring.
   ------------------------------------------------------------------ */
const CYCLE = [
  { en: 'OBSERVE', ar: 'راقب', tool: 'read_file' },
  { en: 'PLAN', ar: 'خطّط', tool: 'propose_plan' },
  { en: 'ACT', ar: 'نفّذ', tool: 'run_command' },
  { en: 'VERIFY', ar: 'تحقّق', tool: 'test_run' },
];

function ThinkingCircle() {
  const { tx } = useLang();
  const cx = 220, cy = 205, R = 100;
  return (
    <svg viewBox="0 0 440 410" className="fp-svg" aria-hidden="true">
      <g fill="none" stroke="currentColor">
        <circle cx={cx} cy={cy} r={R} strokeWidth=".7" opacity=".2" />
        <circle cx={cx} cy={cy} r={R - 26} strokeWidth=".6" strokeDasharray="2 8" opacity=".28" />
        <path d={`M${cx - 160} ${cy}h320M${cx} ${cy - 160}v320`} strokeWidth=".5" opacity=".1" />
      </g>
      <g className="fp-think-wrap">
        <g className="fp-think-orbit">
          <line x1={cx + R} y1={cy - 5} x2={cx + R} y2={cy + 5} stroke="var(--accent)" strokeWidth="1.4" />
          <circle cx={cx + R} cy={cy} r="3.4" fill="var(--accent)" stroke="none" />
        </g>
      </g>
      {CYCLE.map((s, i) => {
        const deg = -90 + i * 90;
        const node = polar(cx, cy, R, deg);
        const lab = polar(cx, cy, R + 25, deg);
        const right = Math.cos((deg * Math.PI) / 180) >= 0;
        const style = { '--i': i } as CSSProperties;
        return (
          <g className="fp-stage" style={style} key={s.en}>
            <circle cx={node.x} cy={node.y} r="9" fill="var(--paper)" stroke="currentColor" strokeWidth=".8" />
            <circle className="fp-stage-pip" cx={node.x} cy={node.y} r="2.6" fill="var(--accent)" stroke="none" />
            <text x={lab.x} y={lab.y + 3} textAnchor={right ? 'start' : 'end'} className="fp-st-label">{tx(s.en, s.ar)}</text>
            <text x={lab.x} y={lab.y + 14} textAnchor={right ? 'start' : 'end'} className="fp-st-tool">{s.tool}</text>
          </g>
        );
      })}
      <g className="fp-think-core">
        <circle cx={cx} cy={cy} r="30" fill="var(--bg1)" stroke="currentColor" strokeWidth=".7" />
        <circle cx={cx} cy={cy} r="24" fill="none" stroke="currentColor" strokeWidth=".5" opacity=".35" />
        <text x={cx} y={cy + 1} textAnchor="middle" className="fp-core-label">{tx('THINK', 'تفكير')}</text>
        <text x={cx} y={cy + 15} textAnchor="middle" className="fp-core-sub">{tx('LOOP', 'حلقة')}</text>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------
   PLATE 04 — MEMORY PLAYBOOK. Four layers of learned knowledge fan
   into a stack; a revision rail counts the versions. Scroll + hover.
   ------------------------------------------------------------------ */
function MemoryPlaybook() {
  const { tx } = useLang();
  const sheets = [
    { label: tx('WORKED', 'ما نجح'), count: 12 },
    { label: tx('FAILED', 'ما فشل'), count: 5 },
    { label: tx('PREFERENCES', 'التفضيلات'), count: 8 },
    { label: tx('RECIPES', 'الوصفات'), count: 3 },
  ];
  return (
    <svg viewBox="0 0 440 340" className="fp-svg" aria-hidden="true">
      <g fill="none" stroke="currentColor" opacity=".22">
        <path d="M62 46V292M378 46V292" strokeWidth=".6" />
        {Array.from({ length: 10 }, (_, i) => (
          <path key={i} d={`M62 ${58 + i * 25}h${i % 2 ? 5 : 9}`} strokeWidth=".6" />
        ))}
      </g>
      <text x="62" y="36" className="fp-rail-label">REV / 04</text>
      <text x="378" y="36" textAnchor="end" className="fp-rail-label">PLAYBOOK.md</text>
      {sheets.map((s, i) => {
        const y = 70 + i * 50;
        return (
          <g className="fp-sheet" style={{ '--i': i } as CSSProperties} key={s.label}>
            <g className="fp-sheet-in" style={{ '--s': i } as CSSProperties}>
              <rect x="92" y={y} width="256" height="34" fill="var(--paper)" stroke="currentColor" strokeWidth=".8" />
              <line x1="92" y1={y} x2="100" y2={y - 8} stroke="currentColor" strokeWidth=".6" opacity=".5" />
              <text x="106" y={y + 21} className="fp-sheet-label">{s.label}</text>
              <line x1="214" y1={y + 12} x2="322" y2={y + 12} stroke="currentColor" strokeWidth=".6" opacity=".4" />
              <line x1="214" y1={y + 21} x2="296" y2={y + 21} stroke="currentColor" strokeWidth=".6" opacity=".28" />
              <text x="336" y={y + 22} textAnchor="end" className="fp-sheet-count">×{String(s.count).padStart(2, '0')}</text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------
   PLATE 05 — BYOK / "your keys never leave". A key turns gently in a
   lock while one lime hairline carries trust from bow to hasp. The
   hairline boundary is the machine: nothing on this plate crosses it.
   The outline writes itself once, the key turns, the link flows.
   ------------------------------------------------------------------ */
function KeysDiagram() {
  const { tx } = useLang();
  return (
    <svg viewBox="0 0 440 320" className="fp-svg am-svg" aria-hidden="true">
      {/* the machine boundary — a single hairline, drawn once */}
      <circle className="am-draw" pathLength={1} cx="220" cy="160" r="140" fill="none"
        stroke="currentColor" strokeWidth=".6" opacity=".24" />

      {/* lock: shackle, body, keyhole — 1px, no fill */}
      <g fill="none" stroke="currentColor" strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round">
        <path className="am-draw" pathLength={1} d="M258 152v-20a27 27 0 0 1 54 0v20" />
        <rect className="am-draw" pathLength={1} x="250" y="152" width="70" height="62" />
        <circle cx="285" cy="177" r="5.5" />
        <path d="M285 183v14" />
      </g>

      {/* the key — bow + toothed shaft, turning around its bow */}
      <g className="am-key" style={{ '--art-origin': '118px 178px' } as CSSProperties}
        fill="none" stroke="currentColor" strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="118" cy="178" r="17" />
        <circle cx="118" cy="178" r="7.5" />
        <path d="M135 178h62v12h-10v10h-10v-10h-9" />
        <circle cx="118" cy="178" r="2.4" fill="var(--accent)" stroke="none" />
      </g>

      {/* one flowing hairline + a breathing node: the key stays local */}
      <path className="am-flow" d="M207 178h35" fill="none" stroke="var(--art-lime)" strokeWidth="1" />
      <circle className="am-node-pulse" cx="242" cy="178" r="2.6" fill="var(--art-lime)" stroke="none" />

      <text x="62" y="46" className="fp-rail-label">{tx('LOCAL', 'محلي')}</text>
      <text x="378" y="46" textAnchor="end" className="fp-rail-label">{tx('BYOK · NO RELAY', 'مفتاحك · بلا وسيط')}</text>
      <text x="220" y="266" textAnchor="middle" className="fp-rail-label">
        {tx('CREDENTIALS LOCAL · CALLS DIRECT', 'اعتماد محلي · نداءات مباشرة')}
      </text>
    </svg>
  );
}

function DiagramPlate({ kind }: { kind: DiagramKind }) {
  if (kind === 'bloom') {
    return (
      <Plate n="02" labelEn="TOOL BLOOM" labelAr="تفتّح الأدوات"
        noteEn="145 TOOLS · 8 FAMILIES" noteAr="١٤٥ أداة · ٨ عائلات">
        <ToolBloom />
      </Plate>
    );
  }
  if (kind === 'thinking') {
    return (
      <Plate n="03" labelEn="THINKING CIRCLE" labelAr="دائرة التفكير"
        noteEn="OBSERVE → PLAN → ACT → VERIFY" noteAr="راقب ← خطّط ← نفّذ ← تحقّق">
        <ThinkingCircle />
      </Plate>
    );
  }
  if (kind === 'keys') {
    return (
      <Plate n="05" labelEn="YOUR KEYS" labelAr="مفاتيحك"
        noteEn="LOCAL CREDENTIALS · DIRECT CALLS" noteAr="بيانات محلية · نداءات مباشرة">
        <KeysDiagram />
      </Plate>
    );
  }
  return (
    <Plate n="04" labelEn="MEMORY PLAYBOOK" labelAr="الدليل الحي"
      noteEn="WORKED · FAILED · PREFS · RECIPES" noteAr="نجح · فشل · تفضيلات · وصفات">
      <MemoryPlaybook />
    </Plate>
  );
}

/* Small framed motif per row — the same 1px grammar, one idea per motif.
   The frame and the main stroke write themselves once; a data line flows
   through the grid; the branch / orbit node breathes. No card, no fill. */
function MiniDiagram({ m }: { m: number }) {
  return (
    <svg viewBox="0 0 120 64" className="fp-mini-svg am-svg" aria-hidden="true">
      <rect className="am-draw" pathLength={1} x=".5" y=".5" width="119" height="63" fill="none" stroke="currentColor" strokeWidth=".7" opacity=".28" />
      {m === 0 && (
        <g fill="none" stroke="currentColor" strokeWidth=".7">
          <circle className="am-draw" pathLength={1} cx="60" cy="32" r="20" opacity=".4" />
          <circle cx="60" cy="32" r="11" opacity=".25" />
          <circle className="fp-mini-accent" cx="80" cy="32" r="2.6" fill="var(--accent)" stroke="none" />
          <circle cx="60" cy="32" r="2" fill="currentColor" stroke="none" />
        </g>
      )}
      {m === 1 && (
        <g fill="none" stroke="currentColor" strokeWidth=".6" opacity=".5">
          {[0, 1, 2, 3].map((i) => <path key={'v' + i} d={`M${24 + i * 24} 12v40`} />)}
          {[0, 1, 2].map((i) => <path key={'h' + i} d={`M24 ${12 + i * 20}h72`} />)}
          <rect className="fp-mini-accent" x="48" y="32" width="24" height="20" fill="var(--accent-fill)" stroke="var(--accent)" opacity=".65" />
          <path className="am-flow" d="M24 42h72" stroke="var(--art-lime)" strokeWidth=".9" />
        </g>
      )}
      {m === 2 && (
        <g fill="none" stroke="currentColor" strokeWidth=".7" opacity=".55">
          <path className="am-draw" pathLength={1} d="M60 52V30M60 30 40 14M60 30 80 14" />
          <circle className="am-node-pulse" cx="40" cy="14" r="2.5" fill="currentColor" stroke="none" />
          <circle cx="80" cy="14" r="2.5" fill="currentColor" stroke="none" />
          <circle className="fp-mini-accent" cx="60" cy="52" r="2.5" fill="var(--accent)" stroke="none" />
        </g>
      )}
      {m === 3 && (
        <g fill="none" stroke="currentColor" strokeWidth=".7" opacity=".5">
          <path className="am-draw" pathLength={1} d="M18 42h16l8-20 10 30 10-38 8 28h32" />
          <circle className="fp-mini-accent" cx="82" cy="42" r="2.6" fill="var(--accent)" stroke="none" />
        </g>
      )}
    </svg>
  );
}

function FeatureRow({ row, index }: { row: Row; index: number }) {
  const { tx } = useLang();
  return (
    <InkReveal as="article" className="fplate" index={index % 3} threshold={0.15}>
      <span className="fplate-num mono">{String(index + 1).padStart(2, '0')}</span>
      <div className="fplate-glyph">
        <MiniDiagram m={(index + row.chips.length) % 4} />
        <span className="fplate-glyph-tag mono">FIG·{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="fplate-copy">
        <span className="fplate-ico">{row.icon}</span>
        <h3 className="h3">{tx(row.en[0], row.ar[0])}</h3>
        <p>{tx(row.en[1], row.ar[1])}</p>
      </div>
      <div className="fplate-spec">
        <span className="label">{tx('SPEC', 'المواصفات')}</span>
        {row.chips.map((c) => (
          <span className="fplate-spec-item mono" key={c}><i aria-hidden="true" />{c}</span>
        ))}
      </div>
    </InkReveal>
  );
}

function CommandPalette() {
  const { tx } = useLang();
  const reduce = useReducedMotion();
  const L = (s: string) => tx(s, s);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState('');
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (reduce) {
      setTyped(TOOL_CYCLE[0].name);
      setResult(TOOL_CYCLE[0].result);
      return;
    }
    if (paused) return;
    let word = 0;
    let char = 0;
    let timer = 0;
    const step = () => {
      const tool = TOOL_CYCLE[word];
      if (char <= tool.name.length) {
        setTyped(tool.name.slice(0, char));
        setResult(char === tool.name.length ? tool.result : '');
        char += 1;
        timer = window.setTimeout(step, char === 1 ? 420 : 52);
      } else {
        char = 0;
        word = (word + 1) % TOOL_CYCLE.length;
        setResult('');
        timer = window.setTimeout(step, 1600);
      }
    };
    timer = window.setTimeout(step, 320);
    return () => window.clearTimeout(timer);
  }, [reduce, paused]);
  return (
    <div className="palette">
      <div className="palette-head">
        <span className="label">⌘ {tx('COMMAND PALETTE', 'لوحة الأوامر')}</span>
        <span className="label">{tx('TOOLS / LIVE', 'الأدوات / مباشر')}</span>
      </div>
      <div className="palette-input" dir="ltr">
        <span className="palette-prompt">{L('›')}</span>
        <span className="palette-typed">{L(typed)}</span>
        {result && <span className="palette-result">{L('→')} {L(result)}</span>}
        <span className="caret" />
      </div>
      <div className="palette-suggest">
        {TOOL_CYCLE.slice(0, 4).map((t) => (
          <button type="button" className="palette-item" key={t.name} dir="ltr"
            onClick={() => { setPaused(true); setTyped(t.name); setResult(t.result); }}>
            <span className="palette-item-mark">{L('·')}</span>{L(t.name)}
            <span className="palette-item-result">{L(t.result)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function FeaturesPage() {
  const { tx } = useLang();
  const [active, setActive] = useState(GROUPS[0].id);

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
    GROUPS.forEach((g) => {
      const el = document.getElementById(g.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* HERO + ANATOMY PLATE */}
      <section className="wrap feat-hero">
        <div className="sec-head">
          <div className="sec-index">◆ {tx('CATALOG / v11.12', 'كتالوج / 11.12')}</div>
          <div className="sec-body">
            <span className="label">{tx('THE TOOL SURFACE', 'سطح الأدوات')}</span>
            <h1 className="display" style={{ marginTop: 24 }}>
              {tx('145 tools, MCP servers', '١٤٥ أداة وسيرفرات MCP')}
              <br />
              <span className="accent serif italic">{tx('and subagents.', 'ووكلاء متخصصون.')}</span>
            </h1>
            <p className="lead">
              {tx(
                'A local-first AI coding agent with MCP support. It reads and edits files, runs commands and calls 145 tools; the same engine runs in sadeem run. Every capability below ships in v11.12.0 — no vaporware, no imaginary buttons.',
                'وكيل برمجة ذكي محلي يدعم MCP. يقرأ الملفات ويعدّلها ويشغّل الأوامر ويستدعي ١٤٥ أداة؛ والمحرك نفسه يعمل في sadeem run. كل قدرة أدناه مشحونة في ١١٫١٢٫٠ — بلا وعود فارغة ولا أزرار متخيّلة.',
              )}
            </p>
          </div>
        </div>
        <InkReveal className="fp-hero-plate" index={0}>
          <AnatomyDiagram />
        </InkReveal>
        <hr className="rule-art fp-hero-rule" />
      </section>

      {/* INDEX + SECTIONS */}
      <div className="wrap feat-body">
        <aside className="feat-index" aria-label={tx('Feature index', 'فهرس الميزات')}>
          <span className="label">{tx('ON THIS PAGE', 'في هذه الصفحة')}</span>
          <nav className="feat-index-nav">
            {GROUPS.map((g, i) => (
              <a key={g.id} href={`#${g.id}`}
                className={'feat-index-link' + (active === g.id ? ' active' : '')}
                onClick={() => setActive(g.id)}>
                <span className="mono">{String(i + 1).padStart(2, '0')}</span>
                <span>{tx(g.navEn, g.navAr)}</span>
              </a>
            ))}
          </nav>
          <div className="feat-index-foot">
            <Link className="link" href="/docs">
              {tx('Read the docs', 'اقرأ الدليل')} <ArrowUpRight size={12} />
            </Link>
          </div>
        </aside>

        <div className="feat-sections">
          {GROUPS.map((g, i) => (
            <section id={g.id} className="feat-section" key={g.id}>
              <InkReveal className="feat-head-reveal" index={0}>
                <div className="sec-head">
                  <div className="sec-index">
                    <span className="sec-glyph">{GLYPHS[g.id]}</span>
                    <span>{String(i + 1).padStart(2, '0')} / {tx(g.navEn, g.navAr)}</span>
                  </div>
                  <div className="sec-body">
                    <h2 className="h2">{tx(g.titleEn, g.titleAr)}</h2>
                    <p className="lead">{tx(g.leadEn, g.leadAr)}</p>
                  </div>
                </div>
              </InkReveal>

              {g.diagram && (
                <div className="fp-diagram-slot">
                  <DiagramPlate kind={g.diagram} />
                </div>
              )}

              <div className="feat-rows">
                {g.rows.map((row, j) => (
                  <FeatureRow key={j} row={row} index={j} />
                ))}
              </div>
            </section>
          ))}

          {/* STATS BAND */}
          <section className="feat-stats-sec">
            <hr className="rule-art" />
            <span className="label feat-stats-label">{tx('BY THE NUMBERS', 'بالأرقام')}</span>
            <div className="feat-stats">
              {STATS.map(([value, en, ar], i) => (
                <InkReveal key={en} index={i}>
                  <div className="stat-num">{value}</div>
                  <div className="stat-label">{tx(en, ar)}</div>
                </InkReveal>
              ))}
            </div>
            <hr className="rule-art" />
          </section>

          {/* TERMINAL PANEL */}
          <section className="feat-term-sec">
            <InkReveal className="feat-head-reveal" index={0}>
              <div className="sec-head">
                <div className="sec-index">
                  {String(GROUPS.length + 1).padStart(2, '0')} / {tx('IN PRACTICE', 'عملياً')}
                </div>
                <div className="sec-body">
                  <h2 className="h2">
                    {tx('What a run', 'ما الذي')} <span className="italic">{tx('reports.', 'تُبلّغ عنه المهمة.')}</span>
                  </h2>
                  <p className="lead">
                    {tx(
                      'Open a workspace and the app reports the engine, tool profile, tools and playbook before the first task.',
                      'افتح مساحة عمل فيُظهر التطبيق المحرك وملف الأدوات والأدوات والدليل الحي قبل المهمة الأولى.',
                    )}
                  </p>
                  <div className="panel panel-pad term">
                    <div className="term-head">
                      <span className="label">TERMINAL</span>
                      <span className="label">SADEEM · v{SITE.version}</span>
                    </div>
                    <pre className="term-body" dir="ltr">{TERM}<span className="caret" /></pre>
                  </div>
                </div>
              </div>
            </InkReveal>
          </section>

          {/* COMMAND PALETTE */}
          <section className="feat-palette-sec">
            <InkReveal className="feat-head-reveal" index={0}>
              <div className="sec-head">
                <div className="sec-index">
                  {String(GROUPS.length + 2).padStart(2, '0')} / {tx('THE SURFACE', 'السطح')}
                </div>
                <div className="sec-body">
                  <h2 className="h2">
                    {tx('Real', 'أسماء')} <span className="italic">{tx('tool names.', 'أدوات حقيقية.')}</span>
                  </h2>
                  <p className="lead">
                    {tx(
                      'Names from the tool registry, typed one key at a time. Pick one from the list to hold it still.',
                      'أسماء من سجل الأدوات تُكتب مفتاحاً بمفتاح. اختر واحداً من القائمة لتثبيته.',
                    )}
                  </p>
                  <CommandPalette />
                </div>
              </div>
            </InkReveal>
          </section>

          {/* CLOSING */}
          <InkReveal as="section" className="feat-close" index={0}>
            <Crosshairs />
            <span className="label">{tx('GET STARTED', 'ابدأ')}</span>
            <h2 className="display">
              {tx('Open a folder.', 'افتح مجلداً.')}{' '}
              <span className="accent italic">{tx('Describe the task.', 'صِف المهمة.')}</span>
            </h2>
            <div className="row">
              <Link className="btn btn-solid" href="/download">
                <ArrowDownToLine size={17} />
                {tx('Download SADEEM', 'حمّل سديم')}
              </Link>
              <Link className="btn" href="/auth">
                {tx('Pair an account', 'اربط حساباً')} <ArrowUpRight size={16} />
              </Link>
            </div>
          </InkReveal>
        </div>
      </div>
    </>
  );
}
