'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useSpring } from 'framer-motion';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { SITE } from '@/lib/site';

type L = { en: string; ar: string };
type Release = {
  version: string;
  date: L;
  codename: L;
  current?: boolean;
  items: L[];
};

/* Dates are taken only from release notes / README files in this repository.
   Where a file states no date, the timeline says so instead of guessing. */
const UNDATED: L = {
  en: 'Date not stated in release notes',
  ar: 'التاريخ غير مذكور في ملاحظات الإصدار',
};

const RELEASES: Release[] = [
  {
    version: '11.12.0',
    date: { en: 'Date not published yet', ar: 'لم يُعلن عن تاريخ الإصدار بعد' },
    codename: { en: 'The current wave', ar: 'الموجة الحالية' },
    current: true,
    items: [
      { en: 'Arena removed — focus stays on the task at hand.', ar: 'أُزيلت الأرينا — يبقى التركيز على المهمة نفسها.' },
      { en: 'Scaffold templates removed — no boilerplate in the way.', ar: 'أُزيلت قوالب الهيكل — لا أكواد جاهزة تعترض الطريق.' },
      { en: 'Living Playbook — the playbook grows as the agent learns from your runs.', ar: 'الدليل الحي — ينمو الدليل كلما تعلّم الوكيل من مهامك.' },
      { en: 'Subagent dashboard — specialist agents in one place.', ar: 'لوحة الوكلاء الفرعيين — الوكلاء المتخصصون في مكان واحد.' },
      { en: '145 tools with tool profiles, so the right set fits the job.', ar: '145 أداة مع ملفات أدوات تناسب كل مهمة.' },
      { en: 'MCP catalog, including Hugging Face and Blender connectors.', ar: 'كتالوج MCP، بما فيه موصّلا Hugging Face و Blender.' },
      { en: 'Redesigned pages across the app.', ar: 'صفحات مُعاد تصميمها في التطبيق.' },
      { en: 'Refined chat typography for long sessions.', ar: 'خطوط محسّنة للمحادثات الطويلة.' },
      { en: 'Schedule dashboard — planned work at a glance.', ar: 'لوحة الجدولة — العمل المخطط له بنظرة واحدة.' },
      { en: 'Workspace file tree for navigating project files inside the app.', ar: 'شجرة ملفات مساحة العمل للتصفح داخل التطبيق.' },
    ],
  },
  {
    version: '11.11.0',
    date: { en: '16 November 2026', ar: '16 نوفمبر 2026' },
    codename: { en: 'Everything works, nothing hangs', ar: 'كل شيء يعمل، لا شيء يتجمد' },
    items: [
      { en: 'Streaming in ~35 ms batches with a byte-level watchdog and an idle watchdog that recover instead of hanging.', ar: 'بث في دفات ~35 مللي ثانية مع مراقب للبايتات ومراقب للخمول يتعافيان بدل التجميد.' },
      { en: 'A structured task report on every terminal path — success, error, abort or stall.', ar: 'تقرير مهمة منظّم في كل مسار نهائي — نجاح أو خطأ أو إلغاء أو توقف.' },
      { en: 'Universal Live Preview for HTML, npm, Python, Go and static artifacts.', ar: 'معاينة حية شاملة لـ HTML و npm و Python و Go والملفات الثابتة.' },
      { en: '118 tools, and a release-day security audit verdict of SHIP.', ar: '118 أداة، ونتيجة التدقيق الأمني يوم الإصدار: جاهز للإطلاق.' },
    ],
  },
  {
    version: '11.9.0',
    date: { en: '15 November 2026', ar: '15 نوفمبر 2026' },
    codename: { en: 'Nothing silent, nothing fake', ar: 'لا صمت، لا تزييف' },
    items: [
      { en: '19 engine streaming fixes: no duplicated reasoning, honest content-filter and refusal handling.', ar: '19 إصلاحاً لبث المحرك: لا تفكير مكرر، وتعامل صريح مع الرقابة والرفض.' },
      { en: 'Renderer fixes: no blinking cursor forever, and reloaded sessions never appear live.', ar: 'إصلاحات في الواجهة: لا مؤشر يومض إلى الأبد، ولا جلسة محمّلة تظهر كأنها نشطة.' },
      { en: '15 transcript display fixes and 34 missing English and Arabic translation keys added.', ar: '15 إصلاحاً لعرض المحادثة وإضافة 34 مفتاح ترجمة ناقصاً بالإنجليزية والعربية.' },
    ],
  },
  {
    version: '11.8.0',
    date: { en: '15 November 2026', ar: '15 نوفمبر 2026' },
    codename: { en: 'Deep Space Console', ar: 'وحدة الفضاء العميق' },
    items: [
      { en: 'A THINK / WORK / BUILD / RUN / PROVE phase timeline replaced stacked boxed cards.', ar: 'خط زمني لمراحل التفكير والعمل والبناء والتشغيل والإثبات بدل البطاقات المتكدّسة.' },
      { en: 'Readable live reasoning with real durations; tool calls as one-line verdict rows.', ar: 'تفكير مباشر مقروء بمدد حقيقية؛ واستدعاءات الأدوات كصفوف حكم من سطر واحد.' },
      { en: 'REA (Reverse Engineer Anything) shipped as a built-in skill.', ar: 'مهارة REA (الهندسة العكسية لأي شيء) مدمجة في التطبيق.' },
      { en: 'Deep Space design system with re-graded themes.', ar: 'نظام تصميم الفضاء العميق مع ثيمات مُعاد معايرتها.' },
    ],
  },
  {
    version: '11.7.0',
    date: { en: '15 November 2026', ar: '15 نوفمبر 2026' },
    codename: { en: 'Remote + Stream Resilience', ar: 'التحكم عن بُعد + متانة البث' },
    items: [
      { en: 'SADEEM Remote: pair a phone over your own Wi-Fi with a QR code — mirror, send, steer, approve, abort.', ar: 'سديم عن بُعد: اقرن هاتفك عبر شبكتك برمز QR — تابع، أرسل، وجّه، وافق، وألغِ.' },
      { en: 'A 75-second SSE idle watchdog and four turn retries with provider failover.', ar: 'مراقب خمول SSE بـ75 ثانية وأربع محاولات مع تبديل المزوّد.' },
      { en: 'Defensive tool dispatch: parsed calls execute, truncated arguments never do.', ar: 'تنفيذ أدوات وقائي: تُنفّذ الاستدعاءات الصحيحة، ولا تُنفّذ الوسائط المقتطعة.' },
      { en: 'MCP orchestration and a skills-first prompt contract.', ar: 'تنسيق خوادم MCP وعقد مطالبة يجعل المهارات أولاً.' },
    ],
  },
  {
    version: '11.6.0',
    date: { en: '14 November 2026', ar: '14 نوفمبر 2026' },
    codename: { en: 'Guest Pass + Prompt Library', ar: 'تمرير الضيف + مكتبة الأوامر' },
    items: [
      { en: 'A seven-day device-level guest pass on the auth gate.', ar: 'تمرير ضيف لمدة سبعة أيام على مستوى الجهاز في بوابة الدخول.' },
      { en: 'Prompt Library: save, search and re-insert prompts locally.', ar: 'مكتبة الأوامر: احفظ وابحث وأعد إدراج الأوامر محلياً.' },
      { en: 'A What’s New card once per version, and version-derived gate text.', ar: 'بطاقة «ما الجديد» مرة لكل إصدار، ونص بوابة مشتق من رقم الإصدار.' },
    ],
  },
  {
    version: '11.5.0',
    date: UNDATED,
    codename: { en: 'Packaging manifest', ar: 'بيان الحزم' },
    items: [
      { en: 'Full source and prebuilt bundles shipped in one drop.', ar: 'المصدر الكامل والحزم المبنية مسبقاً في إصدار واحد.' },
      { en: 'The complete website bundle shipped with the source package.', ar: 'حزمة الموقع الكاملة شُحنت مع حزمة المصدر.' },
    ],
  },
  {
    version: '11.3.0',
    date: UNDATED,
    codename: { en: 'The honest core, kept', ar: 'الجوهر الصادق كما هو' },
    items: [
      { en: 'Palette refinement with a quiet lemon accent.', ar: 'تحسين اللوحة مع ليموني هادئ.' },
      { en: 'Honest agent core intact: Ed25519 proofs, a false-done ledger and a mutation gate.', ar: 'جوهر الوكيل الصادق كما هو: إثباتات Ed25519 وسجل الإنجاز الكاذب وبوابة التعديل.' },
      { en: '159 of 159 tests passed.', ar: 'نجاح 159 من 159 اختباراً.' },
    ],
  },
  {
    version: '11.0.0',
    date: UNDATED,
    codename: { en: 'Center stage', ar: 'المسرح المركزي' },
    items: [
      { en: 'Stage Rails: panels for sessions, git, MCP, usage, DNA, flows, skills, artifacts, library, wiki and arena.', ar: 'أشرطة المسرح: لوحات للجلسات و Git و MCP والاستخدام والـDNA والتدفقات والمهارات والنتائج والمكتبة والويكي والأرينا.' },
      { en: 'Verified with real screenshots from the running app.', ar: 'مُتحقّق منه بلقطات حقيقية من التطبيق العامل.' },
    ],
  },
  {
    version: '10.3.0',
    date: UNDATED,
    codename: { en: 'Launch-ready', ar: 'جاهز للإطلاق' },
    items: [
      { en: 'Flat Codex-style settings: 20 independent sections instead of six groups.', ar: 'إعدادات مسطّحة بنمط Codex: 20 قسماً مستقلاً بدل ست مجموعات.' },
      { en: 'Multi-environment Live Preview: Python and custom run commands, no package.json required.', ar: 'معاينة حية متعددة البيئات: Python وأوامر تشغيل مخصصة دون الحاجة إلى package.json.' },
      { en: 'The device_launch_app tool brought the inventory to 83 tools, behind an approval gate.', ar: 'أداة device_launch_app رفعت عدد الأدوات إلى 83 خلف بوابة موافقة.' },
      { en: 'A 33-command slash menu and a live MCP round-trip.', ar: 'قائمة أوامر مختصرة بـ33 أمراً واتصال MCP حي.' },
    ],
  },
];

/* SIGNATURE ELEMENT — a node centred exactly on the rail (10,10 of 20). */
function InkNode({ current }: { current?: boolean }) {
  return (
    <svg className="c-node" viewBox="0 0 20 20" aria-hidden="true">
      <circle className="c-node-blob" cx="10" cy="10" r="8.2" />
      <circle className="c-node-dot" cx="10" cy="10" r="2.4" />
      {current && <path className="c-node-tick" d="M10 0v3M10 17v3M0 10h3M17 10h3" />}
    </svg>
  );
}

/* A small radiating stamp for the current wave — 24 rays at exactly 15°. */
function RadiatingStamp() {
  const N = 24;
  const rays = Array.from({ length: N }, (_, i) => {
    const a = -Math.PI / 2 + (i / N) * Math.PI * 2;
    return (
      <line
        key={i}
        x1={30 + Math.cos(a) * 14}
        y1={30 + Math.sin(a) * 14}
        x2={30 + Math.cos(a) * 21}
        y2={30 + Math.sin(a) * 21}
      />
    );
  });
  return (
    <svg className="c-stamp" viewBox="0 0 60 60" aria-hidden="true">
      <g className="c-stamp-rays" stroke="var(--accent)" strokeWidth="1" strokeLinecap="round">{rays}</g>
      <circle cx="30" cy="30" r="10" fill="var(--paper)" stroke="var(--accent)" strokeWidth="1.2" />
      <path d="M30 24l1.6 4.4 4.4 1.6-4.4 1.6L30 36l-1.6-4.4L24 30l4.4-1.6z" fill="var(--accent)" />
    </svg>
  );
}

export function ChangelogPage() {
  const { tx } = useLang();
  const [filter, setFilter] = useState<string>('all');
  const shown = filter === 'all' ? RELEASES : RELEASES.filter((r) => r.version === filter);
  const railRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  /* Both ends use the viewport centre line, so progress advances by exactly
     one element-height of scrolling and tracks the rail's real height — not
     the viewport height or the whole page. */
  const { scrollYProgress } = useScroll({ target: railRef, offset: ['start center', 'end center'] });
  const drawn = useSpring(scrollYProgress, { stiffness: 140, damping: 26, restDelta: 0.001 });

  return (
    <div className="c-page">
      {/* HERO */}
      <section className="wrap c-hero">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <span className="label">◆ {tx('RELEASE HISTORY', 'سجل الإصدارات')} · v{SITE.version}</span>
          <h1 className="display" style={{ marginTop: 26 }}>
            {tx('Changelog', 'سجل التحديثات')}
          </h1>
          <p className="lead c-hero-lead">
            {tx('An editorial timeline of what actually shipped, drawn from the release notes and README files in this repository.', 'خط زمني تحريري لما شُحن فعلاً، مأخوذ من ملاحظات الإصدار وملفات README في هذا المستودع.')}
          </p>
        </motion.div>
      </section>

      {/* FILTERS */}
      <section className="wrap section-tight" style={{ paddingTop: 0 }}>
        <div className="c-toolbar">
          <div className="c-toolbar-row">
            <span className="label">{tx('FILTER BY VERSION', 'تصفية حسب الإصدار')}</span>
            <div className="c-filters" role="group" aria-label={tx('Filter releases by version', 'تصفية الإصدارات حسب الإصدار')}>
              <button
                type="button"
                className="c-filter"
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                {tx('All releases', 'كل الإصدارات')}
              </button>
              {RELEASES.map((r) => (
                <button
                  key={r.version}
                  type="button"
                  className="c-filter"
                  aria-pressed={filter === r.version}
                  onClick={() => setFilter(r.version)}
                >
                  v{r.version}
                </button>
              ))}
            </div>
          </div>
          <p className="c-count">
            {tx(`SHOWING ${shown.length} OF ${RELEASES.length} RELEASES`, `عرض ${shown.length} من ${RELEASES.length} إصداراً`)}
          </p>
        </div>

        {/* TIMELINE */}
        <div className="c-timeline" ref={railRef}>
          <span className="c-rail" aria-hidden="true">
            <motion.span className="c-rail-fill" style={{ scaleY: reduce ? 1 : drawn }} />
          </span>
          {shown.map((r) => (
            <motion.article
              className={'c-entry' + (r.current ? ' is-current' : '')}
              key={r.version}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55 }}
            >
              <div className="c-version-col">
                <InkNode current={r.current} />
                <h2 className="c-ver">v{r.version}</h2>
                <div className="c-meta">
                  <time>{tx(r.date.en, r.date.ar)}</time>
                  {r.current && <span className="c-badge">{tx('CURRENT', 'الحالي')}</span>}
                </div>
                {r.current && <RadiatingStamp />}
              </div>
              <div className="c-detail">
                <h3 className="h3">{tx(r.codename.en, r.codename.ar)}</h3>
                <ul className="c-notes">
                  {r.items.map((item, i) => (
                    <li className="c-note" key={i}>
                      <span className="c-note-no mono">{String(i + 1).padStart(2, '0')}</span>
                      <span>{tx(item.en, item.ar)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.article>
          ))}
        </div>

        <p className="small dim c-honesty">
          {tx('Dates come only from release notes and README files in this repository. Where a file states no date, the timeline says so instead of guessing.', 'التواريخ مأخوذة فقط من ملاحظات الإصدار وملفات README في هذا المستودع. وحيث لا يذكر الملف تاريخاً، نقول ذلك صراحةً بدل التخمين.')}
        </p>

        {/* CLOSING */}
        <div className="c-cta">
          <div>
            <h2 className="h3">{tx('Ready to try v' + SITE.version + '?', 'جاهز لتجربة v' + SITE.version + '؟')}</h2>
            <p>{tx('Windows 10/11 x64 builds: installer and portable ZIP.', 'حزمتا ويندوز 10/11 x64: مثبّت وملف مضغوط محمول.')}</p>
          </div>
          <div className="row">
            <Link className="btn btn-solid" href="/download">
              <ArrowRight size={16} aria-hidden="true" />
              {tx('Go to download', 'اذهب إلى التحميل')}
            </Link>
            <a className="btn" href={SITE.repo} target="_blank" rel="noreferrer">
              {tx('Source on GitHub', 'المصدر على GitHub')} <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
