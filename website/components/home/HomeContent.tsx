'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  CalendarCheck2,
  Check,
  Code2,
  Download,
  GitBranch,
  Languages,
  LockKeyhole,
  Plug,
  Puzzle,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useLang } from '@/lib/i18n';
import { SITE } from '@/lib/site';
import { Reveal } from './Reveal';
import { TerminalDemo } from './TerminalDemo';
import { ProviderLogo } from './ProviderLogo';

const METRICS = [
  { value: '145', en: 'tools', ar: 'أداة' },
  { value: '16', en: 'specialist agents', ar: 'وكيل متخصص' },
  { value: '12', en: 'providers', ar: 'مزوّد' },
  { value: '2x', en: 'deep-effort steps', ar: 'ضعف خطوات الجهد العميق' },
];

const TRUST_LOGOS = [
  { slug: 'anthropic', name: 'Anthropic' },
  { slug: 'openai', name: 'OpenAI' },
  { slug: 'google', name: 'Google' },
  { slug: 'ollama', name: 'Ollama' },
  { slug: 'mistral', name: 'Mistral' },
  { slug: 'deepseek', name: 'DeepSeek' },
  { slug: 'xai', name: 'xAI' },
  { slug: 'openrouter', name: 'OpenRouter' },
];

const PLAYBOOK_STEPS = [
  { v: 'v1', en: 'Mapped the repo and its conventions', ar: 'رسم خريطة المستودع واتفاقياته' },
  { v: 'v2', en: 'Recorded: this project uses pnpm', ar: 'سجّل: هذا المشروع يستخدم pnpm' },
  { v: 'v3', en: 'Preference: small, atomic commits', ar: 'تفضيل: التزامات صغيرة وذرية' },
  { v: 'v4', en: 'Correction: run tests before a PR', ar: 'تصحيح: تشغيل الاختبارات قبل طلب السحب' },
  { v: 'v5', en: 'Recipe: deploy via /scripts/deploy.sh', ar: 'وصفة: النشر عبر /scripts/deploy.sh' },
  { v: 'v6', en: 'Note: Arabic UI copy in RTL', ar: 'ملاحظة: واجهة عربية باتجاه RTL' },
  { v: 'v7', en: 'Today: read before the next run', ar: 'اليوم: تُقرأ قبل المهمة التالية' },
];

type Feature = {
  icon: ReactNode;
  tag: string;
  en: { title: string; body: string };
  ar: { title: string; body: string };
};

const FEATURES: Feature[] = [
  {
    icon: <Wrench size={20} />,
    tag: '145 tools',
    en: {
      title: '145 named tools',
      body: '145 tools with schemas and routing descriptions. Profiles change the menu for one turn, never what may be called. Writes and commands pass the approval gate.',
    },
    ar: {
      title: '١٤٥ أداة بأسماء معروفة',
      body: '١٤٥ أداة بمخططات ووصف توجيهي. تغيّر ملفات الأدوات ما يراه النموذج في دورة واحدة، لا ما يستطيع استدعاءه. تمر التعديلات والأوامر عبر بوابة الموافقة.',
    },
  },
  {
    icon: <Plug size={20} />,
    tag: 'MCP',
    en: {
      title: 'Connect your own MCP servers',
      body: 'Connect servers over stdio, HTTP or SSE. Descriptions are scanned for poisoning; servers can be quarantined and changed definitions need re-approval. Risky calls wait for approval.',
    },
    ar: {
      title: 'اربط سيرفرات MCP التي تختارها',
      body: 'اربط السيرفرات عبر stdio أو HTTP أو SSE. تفحص الأوصاف بحثاً عن التسميم، ويمكن حظر السيرفر، ويحتاج تغيير التعريف موافقة جديدة. النداءات الخطرة تنتظر موافقتك.',
    },
  },
  {
    icon: <Bot size={20} />,
    tag: '16 agents',
    en: {
      title: 'Specialist subagents',
      body: 'Delegate to agents that run their own loop with the full tool registry. They differ by role — explorer, debugger, security auditor — not by capability. Parallel runs do not stall each other.',
    },
    ar: {
      title: 'وكلاء متخصصون',
      body: 'فوّض العمل لوكلاء يشغّلون حلقتهم بالسجل الكامل للأدوات. يختلفون بالدور — مستكشف، مصحح، مدقق أمني — لا بالقدرة. ولا يعلّق تشغيلٌ تشغيلاً آخر.',
    },
  },
  {
    icon: <GitBranch size={20} />,
    tag: 'parallel',
    en: {
      title: 'Isolated worktrees',
      body: 'Create a git worktree in one call, then point a parallel session at it. Before a write, a shadow-commit snapshots files without touching your index or stash; /undo restores files and the conversation.',
    },
    ar: {
      title: 'مساعات عمل معزولة',
      body: 'أنشئ worktree باستدعاء واحد، ثم وجّه جلسة موازية إليه. قبل التعديل يلتقط الوكيل نسخة shadow-commit دون لمس الفهرس أو الـstash، ويُرجع /undo الملفات والمحادثة.',
    },
  },
  {
    icon: <CalendarCheck2 size={20} />,
    tag: 'cron',
    en: {
      title: 'Scheduled runs with a test gate',
      body: 'Put recurring work on a cron. A scheduled run uses the same agent engine and is not called done unless the workspace test suite passes. Each run is recorded with its next time and status.',
    },
    ar: {
      title: 'مهام مجدولة ببوابة اختبار',
      body: 'ضع العمل المتكرر على جدول زمني. تستخدم المهمة المجدولة محرك الوكيل ذاته، ولا تُعتبر منتهية إلا إذا نجحت اختبارات مساحة العمل. تُسجّل كل مهمة مع موعدها التالي وحالتها.',
    },
  },
  {
    icon: <Languages size={20} />,
    tag: 'RTL / LTR',
    en: {
      title: 'Arabic and English',
      body: 'A true RTL layout, Cairo typography and a one-tap switch. Prompt in Arabic or English. Each string carries one language, so nothing is mixed and no direction is broken.',
    },
    ar: {
      title: 'العربية والإنجليزية',
      body: 'تخطيط RTL حقيقي وخط القاهرة وزر تبديل بلمسة واحدة. اكتب المطالبات بالعربية أو الإنجليزية. كل نص بلغة واحدة، فلا خلط ولا اتجاه مكسور.',
    },
  },
  {
    icon: <Puzzle size={20} />,
    tag: 'extend',
    en: {
      title: 'Skills and plugins',
      body: 'Save a repeatable procedure as a skill at workspace, global or built-in scope. Load it in one call when a task matches. Plugins can contribute MCP servers and slash commands.',
    },
    ar: {
      title: 'مهارات وإضافات',
      body: 'احفظ إجراءً متكرراً كمهارة على مستوى مساحة العمل أو العام أو المدمج. حمّلها باستدعاء واحد عندما تطابق مهمتك. يمكن للإضافات أن تضيف سيرفرات MCP وأوامر شرطة مائلة.',
    },
  },
  {
    icon: <Code2 size={20} />,
    tag: 'LSP + DAP',
    en: {
      title: 'Code intelligence and debugging',
      body: 'Definition, hover, diagnostics, references and rename come from language servers. Breakpoints, variable inspection and stepping come from a DAP debugger. If a server is missing, the tool returns the exact install command.',
    },
    ar: {
      title: 'ذكاء الكود والتصحيح',
      body: 'الانتقال إلى التعريف والتلميحات والتشخيصات والمراجع وإعادة التسمية تأتي من خوادم لغات حقيقية. ونقاط التوقف وفحص المتغيرات والخطوة بخطوة من مصحح DAP. وعند غياب الخادم يُعيد الأداة أمر التثبيت الدقيق.',
    },
  },
  {
    icon: <ShieldCheck size={20} />,
    tag: 'local-first',
    en: {
      title: 'Keys and files stay local',
      body: 'Credentials are stored locally and provider calls go straight to the provider you chose. Text from a fetched page or a repo README is marked with its origin; dangerous commands stop for approval. Learning notes are plain files you can read, edit or delete.',
    },
    ar: {
      title: 'المفاتيح والملفات تبقى محلياً',
      body: 'تُحفظ بيانات الاعتماد محلياً، وتذهب استدعاءات المزوّد مباشرة إليه. يُوسَم النص القادم من صفحة ويب أو ملف README بمصدره، وتتوقف الأوامر الخطرة للموافقة. وملاحظات التعلّم ملفات عادية يمكنك قراءتها وتعديلها وحذفها.',
    },
  },
];

const STEPS = [
  {
    n: '01',
    en: { t: 'Install and open a folder', b: 'Run the Windows installer or unzip the portable ZIP. Point SADEEM at a project folder. It maps the files before the first task.' },
    ar: { t: 'ثبّت وافتح مجلداً', b: 'شغّل مُثبّت ويندوز أو فكّ الضغط عن الملف المحمول. وجّه سادم إلى مجلد المشروع. يرسم خريطة الملفات قبل المهمة الأولى.' },
  },
  {
    n: '02',
    en: { t: 'Describe the task', b: 'Type a prompt in Arabic or English. The agent plans the steps and calls the tools each step needs.' },
    ar: { t: 'صف المهمة', b: 'اكتب مطلباً بالعربية أو الإنجليزية. يخطّط الوكيل للخطوات ويستدعي الأدوات التي تحتاجها كل خطوة.' },
  },
  {
    n: '03',
    en: { t: 'Approve and check the result', b: 'Review the diff and the run report. Approve writes and commands. The next run reads the saved notes.' },
    ar: { t: 'وافق وتحقق من النتيجة', b: 'راجع الفروق وتقرير التشغيل. وافق على التعديلات والأوامر. تقرأ المهمة التالية الملاحظات المحفوظة.' },
  },
];

const PROVIDERS = [
  'Anthropic', 'OpenAI', 'Google', 'Ollama', 'Mistral', 'DeepSeek',
  'xAI', 'OpenRouter', 'Groq', 'Azure', 'LM Studio', 'Together',
];

function Hero() {
  const { tx } = useLang();
  return (
    <section className="home-hero grid-bg">
      <div className="hero-ambience" aria-hidden="true" />
      <div className="container hero-inner">
        <Reveal className="hero-copy">
          <span className="pill hero-chip">
            <span className="dot" />
            {tx('LOCAL-FIRST AI CODING AGENT', 'وكيل برمجة ذكي يعمل محلياً')}
            <span className="hero-chip-ver mono">v{SITE.version}</span>
          </span>

          <h1 className="h1 hero-title">
            <span className="hero-line">{tx('A local-first AI coding agent', 'وكيل برمجة ذكي يعمل محلياً')}</span>
            <span className="hero-line"><em>{tx('that reads your code', 'يقرأ كودك')}</em></span>
            <span className="hero-line">{tx('and runs real tasks.', 'ويشغّل مهام حقيقية.')}</span>
          </h1>

          <p className="lead hero-lead">
            {tx(
              'SADEEM is a local-first coding agent for Windows. It maps the call sites, edits the files, runs the tests and shows the diff. After a run it writes a versioned PLAYBOOK.md. The same engine runs in sadeem run. Keys stay local; provider calls go direct and your provider bills you.',
              'سادم وكيل برمجة محلي على ويندوز. يرسم مواقع الاستدعاء، ويعدّل الملفات، ويشغّل الاختبارات، ويعرض الفروق. وبعد كل تشغيل يكتب ملف PLAYBOOK.md بإصدارات. يعمل المحرك نفسه في sadeem run. تبقى مفاتيحك محلية، وتذهب استدعاءات المزوّد مباشرة إليه وهو الذي يفاترك.',
            )}
          </p>

          <div className="row hero-actions">
            <Link className="btn btn-primary btn-lg" href="/download">
              <Download size={18} /> {tx('Download for Windows', 'حمّل لـ ويندوز')} <ArrowRight size={17} />
            </Link>
            <Link className="btn btn-lg" href="/features">
              {tx('See features', 'استكشف الميزات')} <ArrowRight size={17} />
            </Link>
          </div>

          <div className="row hero-note">
            <span className="pill"><Check size={13} /> {tx('Free during the public season', 'مجاني خلال الموسم العام')}</span>
            <span className="faint mono hero-note-sep">·</span>
            <span className="faint">{tx('Bring your own key. No proxy.', 'أحضر مفتاحك. لا وسيط.')}</span>
          </div>
        </Reveal>

        <Reveal delay={0.12} className="hero-terminal">
          <TerminalDemo />
        </Reveal>

        <Reveal delay={0.2} className="trust-strip">
          <span className="trust-label mono">{tx('WORKS WITH YOUR PROVIDERS', 'يعمل مع مزوّديك')}</span>
          <div className="trust-row">
            {TRUST_LOGOS.map((p, i) => <ProviderLogo key={p.slug} slug={p.slug} name={p.name} index={i} />)}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Metrics() {
  const { tx } = useLang();
  return (
    <section className="metrics-band" aria-label={tx('SADEEM by the numbers', 'سادم بالأرقام')}>
      <div className="container metrics-grid">
        {METRICS.map((m, i) => (
          <Reveal key={m.value + m.en} delay={i * 0.05} className="metric">
            <div className="metric-value mono">{m.value}</div>
            <div className="metric-label">{tx(m.en, m.ar)}</div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Playbook() {
  const { tx } = useLang();
  return (
    <section className="section" id="playbook">
      <div className="container playbook-grid">
        <Reveal className="playbook-copy">
          <span className="eyebrow">{tx('THE LIVING PLAYBOOK', 'الدليل الحيّ')}</span>
          <h2 className="h2">
            {tx('After a run, a file.', 'بعد كل مهمة، ملف.')}<br />
            <em>{tx('The next run reads it.', 'المهمة التالية تقرأه.')}</em>
          </h2>
          <p className="lead">
            {tx(
              'SADEEM records what worked, what failed and your preferences in PLAYBOOK.md inside your workspace. It keeps a version history with diffs and reads the current file before the next task.',
              'يسجّل سادم ما نجح وما فشل وتفضيلاتك في ملف PLAYBOOK.md داخل مساحة عملك. يحتفظ بسجل إصدارات مع الفروق، ويقرأ الملف الحالي قبل المهمة التالية.',
            )}
          </p>
          <p className="muted playbook-p">
            {tx(
              'Changes appear in a timeline, and a toast marks each learning event. The notes are advice, not instructions: your current request overrides them.',
              'تظهر التغييرات في خط زمني، ويُظهر إشعار كل حدث تعلّم. الملاحظات توجيهية لا إلزامية: طلبك الحالي هو الذي يُنفّذ.',
            )}
          </p>
          <div className="advisory">
            <ShieldCheck size={17} />
            <span>
              {tx(
                'Edit or delete any learned note in the markdown file. Nothing is written back without a run that actually happened.',
                'عدّل أي ملاحظة متعلّمة في ملف Markdown أو احذفها. لا يُكتب شيء من دون مهمة حدثت فعلاً.',
              )}
            </span>
          </div>
          <Link href="/features" className="text-link">
            {tx('Explore the learning loop', 'استكشف حلقة التعلّم')} <ArrowRight size={15} />
          </Link>
        </Reveal>

        <Reveal delay={0.1} className="timeline-card">
          <div className="timeline-head">
            <div className="row" style={{ gap: 8 }}>
              <Sparkles size={15} />
              <span className="mono">{tx('PLAYBOOK.md', 'PLAYBOOK.md')}</span>
            </div>
            <span className="pill">v7</span>
          </div>
          <div className="timeline">
            {PLAYBOOK_STEPS.map((s, i) => (
              <div className="timeline-item" key={s.v} style={{ animationDelay: `${i * 80}ms` }}>
                <span className={'timeline-node' + (i === PLAYBOOK_STEPS.length - 1 ? ' is-current' : '')}>{s.v}</span>
                <span className="timeline-text">{tx(s.en, s.ar)}</span>
              </div>
            ))}
          </div>
          <div className="timeline-foot mono">
            <span className="dot" /> {tx('plain markdown · versioned · editable', 'Markdown عادي · بإصدارات · قابل للتحرير')}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FeatureGrid() {
  const { tx } = useLang();
  return (
    <section className="section section-sm" id="features">
      <div className="container">
        <Reveal className="section-title">
          <span className="eyebrow">{tx('CAPABILITIES', 'القدرات')}</span>
          <h2 className="h2">{tx('From the first file read ', 'من قراءة أول ملف ')}<em>{tx('to the final pull request.', 'إلى طلب السحب الأخير.')}</em></h2>
          <p className="lead">
            {tx('Each capability below is a named tool, a real file or a command you can check in the app.', 'كل قدرة أدناه أداة باسم معروف، أو ملف حقيقي، أو أمر يمكنك التحقق منه في التطبيق.')}
          </p>
        </Reveal>

        <div className="grid grid-3 feat-grid">
          {FEATURES.map((f, i) => (
            <Reveal key={f.tag + i} delay={(i % 3) * 0.07} as="article">
              <article className="card card-accent feat-card">
                <div className="feat-top">
                  <span className="feat-ico">{f.icon}</span>
                  <span className="pill">{f.tag}</span>
                </div>
                <h3 className="h3">{tx(f.en.title, f.ar.title)}</h3>
                <p className="muted">{tx(f.en.body, f.ar.body)}</p>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal className="features-more">
          <Link href="/features" className="btn">
            {tx('See the full feature catalog', 'اطّلع على الكتالوج الكامل للميزات')} <ArrowRight size={16} />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

function HowItWorks() {
  const { tx } = useLang();
  return (
    <section className="section section-sm">
      <div className="container">
        <Reveal className="section-title">
          <span className="eyebrow">{tx('GET STARTED', 'ابدأ')}</span>
          <h2 className="h2">{tx('Three steps. ', 'ثلاث خطوات. ')}<em>{tx('Then check the result.', 'ثم تحقق من النتيجة.')}</em></h2>
        </Reveal>
        <div className="steps-grid">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.1} className="step">
              <span className="step-n mono">{s.n}</span>
              <h3 className="h3">{tx(s.en.t, s.ar.t)}</h3>
              <p className="muted">{tx(s.en.b, s.ar.b)}</p>
              {i < STEPS.length - 1 && <span className="step-connector" aria-hidden="true" />}
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProvidersAndPrivacy() {
  const { tx } = useLang();
  return (
    <section className="section section-sm providers-section">
      <div className="container">
        <Reveal className="section-title">
          <span className="eyebrow">{tx('BRING YOUR OWN KEY', 'أضف مفتاحك')}</span>
          <h2 className="h2">{tx('12 providers. ', '١٢ مزوّداً. ')}<em>{tx('One local agent.', 'وكيل محلي واحد.')}</em></h2>
          <p className="lead">{tx('Add a key from any supported provider, then switch models per task. Your provider bills you for the calls.', 'أضف مفتاحاً من أي مزوّد مدعوم، ثم بدّل النموذج حسب المهمة. مزوّدك هو الذي يحصّل تكلفة الاستدعاءات.')}</p>
        </Reveal>

        <Reveal className="provider-cloud">
          {PROVIDERS.map((p, i) => <span className="provider-pill" key={p + i}>{p}</span>)}
        </Reveal>

        <Reveal delay={0.08} className="privacy-card">
          <div className="privacy-ico"><LockKeyhole size={24} /></div>
          <div className="privacy-body">
            <h3 className="h3">{tx('Your keys stay on your machine.', 'مفاتيحك تبقى على جهازك.')}</h3>
            <p className="muted">
              {tx(
                'Credentials are stored on your machine and calls go directly to the provider you chose. Writes and dangerous commands wait for approval. The playbook is a plain markdown file you can open, edit or delete.',
                'تُحفظ بيانات الاعتماد على جهازك، وتذهب الاستدعاءات مباشرة إلى المزوّد الذي اخترته. التعديلات والأوامر الخطرة تنتظر الموافقة. والدليل الحيّ ملف Markdown عادي يمكنك فتحه وتعديله وحذفه.',
              )}
            </p>
            <div className="row privacy-points">
              <span className="pill"><Check size={13} /> {tx('Local credentials', 'بيانات اعتماد محلية')}</span>
              <span className="pill"><Check size={13} /> {tx('Approval gates', 'بوابات موافقة')}</span>
              <span className="pill"><Check size={13} /> {tx('Local learning files', 'ملفات تعلّم محلية')}</span>
              <span className="pill"><Check size={13} /> {tx('Portable markdown', 'Markdown قابل للنقل')}</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FinalCTA() {
  const { tx } = useLang();
  return (
    <section className="final-cta">
      <div className="container">
        <Reveal className="final-cta-inner">
          <span className="eyebrow">{tx('GET STARTED', 'ابدأ')}</span>
          <h2 className="h2 final-cta-title">
            {tx('Run a task.', 'شغّل مهمة.')}<br /><em>{tx('Review the diff.', 'راجع الفرق.')}</em>
          </h2>
          <p className="lead">
            {tx('Free during the public season. Bring your key, open a folder and describe the task.', 'مجاني خلال الموسم العام. أحضر مفتاحك، وافتح مجلداً، وصف المهمة.')}
          </p>
          <div className="row final-cta-actions">
            <Link className="btn btn-primary btn-lg" href="/download"><Download size={18} /> {tx('Download SADEEM', 'حمّل سادم')} <ArrowRight size={17} /></Link>
            <Link className="btn btn-lg" href="/auth"><Terminal size={17} /> {tx('Create an account', 'إنشاء حساب')}</Link>
          </div>
          <div className="faint mono final-cta-fine">v{SITE.version} · {tx('Windows · BYOK · local files', 'ويندوز · بمفتاحك · ملفات محلية')}</div>
        </Reveal>
      </div>
    </section>
  );
}

export function HomeContent() {
  return (
    <>
      <Hero />
      <Metrics />
      <Playbook />
      <FeatureGrid />
      <HowItWorks />
      <ProvidersAndPrivacy />
      <FinalCTA />
    </>
  );
}
