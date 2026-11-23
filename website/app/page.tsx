'use client';
import Link from 'next/link';
/* v11.40 — the app-mock uses the EXACT lucide names the real shell imports.
 * Rail.tsx: House / Workflow / Blocks / BadgeCheck / Quote / UsersRound /
 * BookOpen / FolderOpen / Files / MoreHorizontal / LayoutGrid / Settings2 /
 * Keyboard / CalendarDays / ShieldCheck (see docs/APP-MOCK-FIDELITY-V1140.md).
 * Composer.tsx / AttachMenu.tsx / ContextLens.tsx: Mic / BookMarked / History /
 * X / Check / Gauge / Copy. ChatPanel.tsx: MessageSquare / MessageSquarePlus /
 * Shrink / Download / Wrench / ChevronDown. The in-house glyphs (IcWorkspace,
 * IcSessions, IcGit, IcMcp, IcUsage, IcDna, IcSearch, IcPreview, IcTerminal,
 * IcSend, IcSpark, IcPlus, IcFile, IcImage) are copied verbatim from
 * src/components/icons.tsx into GLYPHS below — no invented shapes. */
import {
  ArrowDownToLine, ArrowUpRight,
  BadgeCheck, Blocks, BookMarked, BookOpen, CalendarDays, Check, ChevronDown,
  Copy, Download, Files, FolderOpen, Gauge, History, House, Keyboard,
  LayoutGrid, MessageSquare, MessageSquarePlus, Mic, MoreHorizontal, Plus,
  Quote, Settings2, ShieldCheck, Shrink, UsersRound, Workflow, Wrench, X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useLang } from '@/lib/i18n';
import { SITE } from '@/lib/site';
import { SEOContent } from '@/components/home/SEOContent';
import './home.css';
/* v11.39 — precision layer for the app mock only. Imported AFTER home.css so
   its hairline / typography refinements win the cascade without editing D2's
   sheet. The illustrative console section is gone; this sheet is kept only so
   the shared stylesheet contract stays intact. */
import './app-mock.css';
/* v11.42 — hero panel fidelity layer. Imported LAST so the Desktop / Editor /
   CLI miniature UI and its single scoped cursor path win the cascade without
   touching D2's home.css (Z1 owns that sheet). Every selector is scoped to the
   three hero panels; the app-mock system is untouched. */
import './hero-panels.css';

/* ------------------------------------------------------------------ *
 * All copy lives beside the markup in bilingual pairs. Nothing on this
 * page is generated at render time: no Date, no Math.random. Motion is
 * CSS + a one-shot IntersectionObserver that only flips a data attribute.
 * ------------------------------------------------------------------ */

const HERO = {
  eyebrow: ['◆ LOCAL-FIRST AI CODING AGENT', '◆ وكيل برمجة ذكي يعمل محلياً'],
  line1: ['A local-first AI coding agent', 'وكيل برمجة ذكي يعمل محلياً'],
  line2: ['that ', 'يتعلّم '],
  line3: ['learns your workspace.', 'مساحة عملك.'],
  lead: [
    'Point it at a bug or a half-built feature. It maps the call sites, edits the files, runs the tests and shows the diff. After a run it writes what worked into PLAYBOOK.md and keeps every version. Keys stay on your machine; provider calls go direct and your provider bills you.',
    'وجّهه إلى خطأ أو ميزة ناقصة. يرسم مواقع الاستدعاء، ويعدّل الملفات، ويشغّل الاختبارات، ويعرض الفروق. وبعد كل تشغيل يسجّل ما نجح في PLAYBOOK.md ويحتفظ بكل إصدار. تبقى مفاتيحك على جهازك، وتذهب استدعاءات المزوّد مباشرة إليه وهو الذي يفاترك.',
  ],
  cta: ['Download for Windows', 'حمّل لويندوز'],
  more: ['Read the docs', 'اقرأ التوثيق'],
  note: [
    'Bring your own key · Files and learning notes stay on your device · Free during the public season',
    'أحضر مفتاحك · تبقى ملفاتك وملاحظات تعلّمك على جهازك · مجاني خلال الموسم العام',
  ],
  artCaption: [
    'FIG. 01 — Six miniature SADEEM surfaces on one canvas: desktop, editor, terminal, CLI, schedule and mobile.',
    'شكل ٠١ — ست واجهات مصغّرة لسديم على لوحة واحدة: سطح المكتب، المحرر، الطرفية، سطر الأوامر، الجدولة، والهاتف.',
  ],
} as const;

/* ------------------------------------------------------------------ *
 * HERO MOSAIC (v11.41) — the founder rejected both the boxed plate and
 * the orbit. This is an EDITORIAL COLLAGE of six miniature SADEEM windows
 * on a near-black canvas: desktop, editor, terminal, CLI, schedule, mobile.
 * Each panel is a 1px hairline frame with a real-looking mini UI drawn in
 * CSS/markup (never an image). The official lime square + black gear is the
 * visual anchor. No gradients, no shadows, no glow, no single big box.
 * Every string is one language per node; every glyph is a literal, so the
 * server and the first client frame are byte-for-byte identical.
 * ------------------------------------------------------------------ */
const LIME = '#9be515';  // the official accent — the only lime in this artwork
const BLACK = '#000000'; // the gear cut out of the lime square

const HM = {
  head: ['SADEEM / ONE AGENT · SIX SURFACES', 'سديم / وكيل واحد · ست واجهات'],
  source: ['SOURCE / LOCAL WORKSPACE', 'المصدر / مساحة العمل المحلية'],
  panels: [
    ['Desktop', 'سطح المكتب'],
    ['Editor', 'المحرر'],
    ['Terminal', 'الطرفية'],
    ['CLI', 'سطر الأوامر'],
    ['Schedule', 'الجدولة'],
    ['Mobile', 'الهاتف'],
  ],
  session: ['SESSION 01', 'الجلسة ٠١'],
  prompt: ['Ship the preview', 'شغّل المعاينة'],
  files: ['PROJECT FILES', 'ملفات المشروع'],
  diff: ['+ <PreviewArea />', '+ <PreviewArea />'],
  ready: ['READY', 'جاهز'],
  paired: ['DEVICE PAIRED', 'تم اقتران الجهاز'],
  pairCode: ['PAIR 482-719', 'الاقتران ٤٨٢-٧١٩'],
  daily: ['daily review', 'مراجعة يومية'],
  weekly: ['weekly sync', 'مزامنة أسبوعية'],
  providers: ['OPENAI · ANTHROPIC · GOOGLE · OLLAMA · OPENROUTER', 'OpenAI · Anthropic · Google · Ollama · OpenRouter'],
} as const;

/* DEMO now carries ONLY the copy still used by the hero mosaic. The
   illustrative console section was removed by founder request (v11.43);
   its exclusive fields, markup and motion were deleted with it. */
const DEMO = {
  window: ['sadeem — agent workspace', 'سديم — مساحة الوكيل'],
  thinking: ['Thinking', 'يفكّر'],
  toolName: 'read_file',
  toolPath: 'settings/theme-context.ts',
  /* the real tool row carries a duration stamp inside the OK chip */
  toolDuration: '512ms',
  /* --- faithful UI copy, mirrored from the real app source --- */
  session: ['theme toggle · settings', 'مفتاح الثيم · الإعدادات'],
  consoleLabel: ['01 AGENT CONSOLE', '٠١ وحدة الوكيل'],
  /* Rail.tsx PRIMARY — the ONLY visible navigation cluster (4 + Files + More).
     Everything else lives in the More flyout, exactly like the real shell. */
  nav: [
    { no: '00', en: 'Home', ar: 'الرئيسية', glyph: 'home' },
    { no: '01', en: 'Workspace', ar: 'مساحة العمل', glyph: 'workspace' },
    { no: '02', en: 'Sessions', ar: 'الجلسات', glyph: 'sessions' },
    { no: '03', en: 'Source control', ar: 'التحكم بالمصدر', glyph: 'git' },
    { no: '', en: 'Files · project files', ar: 'ملفات المشروع', glyph: 'files' },
  ],
  moreHint: ['All views · 11 sections', 'كل الأقسام · ١١ قسماً'],
  utils: [
    { en: 'Search in files', ar: 'بحث في الملفات', glyph: 'search' },
    { en: 'Live preview', ar: 'معاينة حية', glyph: 'preview' },
    { en: 'Toggle terminal', ar: 'تبديل الطرفية', glyph: 'terminal' },
    { en: 'Settings', ar: 'الإعدادات', glyph: 'settings' },
  ],
  toolOk: ['OK', 'تم'],
  attachPlus: ['Add to chat — image, document, prompts, checkpoint', 'أضف إلى المحادثة'],
  /* Composer.tsx QUICK_COMMANDS — the mono slash hint row. */
  quickCommands: ['/plan', '/review', '/init', '/compact', '/model', '/settings'],
  /* EffortControl.tsx — one spark chip, one honest value. */
  effort: ['Effort', 'الجهد'],
  effortValue: ['standard', 'قياسي'],
  ctxLabel: ['Context window', 'نافذة السياق'],
  ctxValue: '62',
  voice: ['Voice input', 'إدخال صوتي'],
  model: 'claude-3.7-sonnet',
  send: ['Send', 'إرسال'],
  files: [
    { name: 'settings/theme-context.ts', d: 14 },
    { name: 'settings/Toggle.tsx', d: 15 },
    { name: 'settings/theme.test.ts', d: 16 },
    { name: 'PLAYBOOK.md', d: 17 },
  ],
} as const;

const BENEFITS = {
  index: ['§ / WHAT SHIPS', '§ / ما الذي يتوفّر'],
  label: ['THE CAPABILITIES', 'القدرات'],
  title1: ['Three things', 'ثلاثة أشياء'],
  title2: ['you can verify.', 'يمكنك التحقق منها.'],
  items: [
    {
      no: '01',
      tag: ['YOUR KEYS', 'مفاتيحك'],
      title: ['Your keys stay yours.', 'مفاتيحك تبقى ملكك.'],
      body: [
        'Add a key from any supported provider. Credentials stay in local settings; calls go straight to that provider, which bills you. No relay and no resold inference. Start free without an account; sign in only when you want to sync your account or license.',
        'أضف مفتاحاً من أي مزوّد مدعوم. تبقى بيانات الاعتماد في إعدادات محلية، وتذهب الاستدعاءات مباشرة إلى المزوّد الذي يفاترك. بلا وسيط ولا إعادة بيع للاستدلال. ابدأ مجاناً بلا حساب، وسجّل الدخول فقط إذا أردت مزامنة حسابك أو ترخيصك.',
      ],
    },
    {
      no: '02',
      tag: ['PLAYBOOK.md', 'PLAYBOOK.md'],
      title: ['It writes PLAYBOOK.md.', 'يكتب ملف PLAYBOOK.md.'],
      body: [
        'After a run it records what worked, what failed, your preferences and verified recipes in PLAYBOOK.md. Every update bumps a version and keeps a diff. The next run reads the file as advice; your current request wins and learned facts never become bans. Open the markdown and delete a line you disagree with.',
        'بعد كل تشغيل يسجّل ما نجح وما فشل وتفضيلاتك والوصفات المؤكدة في PLAYBOOK.md. كل تحديث يزيد الإصدار ويحتفظ بالفروق. تقرأ المهمة التالية الملف كتوجيه؛ طلبك الحالي هو الذي يُنفّذ، ولا تتحول الحقائق المتعلّمة إلى قيود. افتح ملف md واحذف أي سطر لا توافق عليه.',
      ],
    },
    {
      no: '03',
      tag: ['145 TOOLS · MCP', '١٤٥ أداة · MCP'],
      title: ['145 tools, every one callable.', '١٤٥ أداة، كلها قابلة للاستدعاء.'],
      body: [
        '145 tools ship with schemas and routing descriptions. Profiles change what the model sees for one turn, never what it may call — any tool stays callable by its exact name. Add your own MCP servers when a task needs an external service.',
        'تأتي ١٤٥ أداة بمخططات ووصف يوضّح متى تُستخدم. تغيّر ملفات الأدوات ما يراه النموذج في دورة واحدة، لا ما يستطيع استدعاءه — تبقى كل أداة قابلة للاستدعاء باسمها الدقيق. أضف سيرفرات MCP التي تحتاجها عندما تتطلب المهمة خدمة خارجية.',
      ],
    },
  ],
} as const;

const PROOF = {
  index: ['§ / THE COUNTS', '§ / الأعداد'],
  title1: ['Three counts,', 'ثلاثة أرقام،'],
  title2: ['no estimates.', 'بلا تقديرات.'],
  figures: [
    { n: '145', en: 'TOOLS', ar: 'أداة' },
    { n: '16', en: 'SPECIALISTS', ar: 'وكيل متخصص' },
    { n: '12', en: 'PROVIDERS', ar: 'مزوّد' },
  ],
  note: [
    'Add keys from OpenAI, Anthropic, Google, Ollama, OpenRouter and other supported providers. Switch models per task; the tools and the playbook stay the same.',
    'أضف مفاتيح من OpenAI وAnthropic وGoogle وOllama وOpenRouter وغيرها من المزوّدين المدعومين. بدّل النموذج حسب المهمة؛ تبقى الأدوات والدليل الحي كما هما.',
  ],
} as const;

const CLOSE = {
  label: ['◆ OPEN A FOLDER', '◆ افتح مجلداً'],
  title1: ['Open a folder,', 'افتح مجلداً،'],
  title2: ['run a task.', 'وشغّل مهمة.'],
  lead: [
    'Free during the public season. Add your key, open a project folder and review the diff before any change is kept.',
    'مجاني خلال الموسم العام. أضف مفتاحك، وافتح مجلد المشروع، وراجع الفروق قبل الإبقاء على أي تغيير.',
  ],
  cta: ['Download SADEEM', 'حمّل سديم'],
  more: ['Read the docs', 'اقرأ التوثيق'],
} as const;

/* A thin drawing frame shared by the three benefit plates. Every mark is
   authored geometry — hairlines, dots and open arcs only. */
function Plate({ children }: { children: ReactNode }) {
  return (
    <svg
      className="benefit-svg"
      viewBox="0 0 240 160"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function LocalDiagram() {
  return (
    <Plate>
      <circle cx="120" cy="80" r="72" strokeDasharray="2 8" opacity=".5" />
      <rect x="78" y="34" width="84" height="92" rx="3" />
      <rect x="90" y="48" width="60" height="44" rx="2" opacity=".65" />
      <circle cx="106" cy="70" r="6.5" />
      <path d="M112.5 70h22M126 70v6M131 70v4" />
      <circle cx="106" cy="70" r="1.8" fill="currentColor" stroke="none" />
      <path d="M46 146h148" opacity=".35" />
      <circle cx="120" cy="8" r="1.5" fill="currentColor" stroke="none" />
    </Plate>
  );
}

function PlaybookDiagram() {
  return (
    <Plate>
      <path d="M74 26h58l24 24v86H74z" />
      <path d="M132 26v24h24" opacity=".6" />
      <path d="M86 64h68M86 78h68M86 92h48M86 106h60" opacity=".55" />
      <circle cx="120" cy="92" r="13" />
      <path d="M114 92l4 4 8-9" />
      <path d="M180 52A66 66 0 1 0 180 108" />
      <path d="M171 104l9 4 4-9" />
      <circle cx="120" cy="92" r="1.6" fill="currentColor" stroke="none" />
    </Plate>
  );
}

function ToolsDiagram() {
  const nodes = [
    [196, 80],
    [172, 36],
    [68, 36],
    [44, 80],
    [68, 124],
    [172, 124],
  ] as const;
  return (
    <Plate>
      <circle cx="120" cy="80" r="58" strokeDasharray="2 7" opacity=".4" />
      {nodes.map(([x, y], i) => (
        <line key={i} x1="120" y1="80" x2={x} y2={y} opacity={i % 2 ? '.55' : '.8'} />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3.4" fill="currentColor" stroke="none" />
      ))}
      <circle cx="120" cy="80" r="16" />
      <text className="benefit-fig-num" x="120" y="84" textAnchor="middle">145</text>
    </Plate>
  );
}

/* ------------------------------------------------------------------ *
 * HERO MOSAIC (v11.41) — the founder rejected both the boxed plate and
 * the orbit. The replacement is an EDITORIAL COLLAGE of six miniature
 * SADEEM windows on a near-black canvas, anchored by the official lime
 * square + black gear. Every panel is a 1px hairline frame with a real
 * mini UI drawn in markup/CSS — never an image, never one big rectangle.
 * The component is named for what it now is: a mosaic, not an engraving.
 * Decorative, but named with one bilingual accessible label; all inner
 * text is aria-hidden and single-language per node. No Date/random.
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ *
 * HERO PANEL CURSOR GEOMETRY (v11.42) — intentionally SEPARATE from the
 * former app-mock pointer system (removed with the console section). One small effect
 * measures the REAL rendered composer input, "+" trigger and Send inside
 * the Desktop miniature and publishes their centres as --hm-c-* pixels on
 * that panel. The single `hm-cursor-path` keyframe in hero-panels.css reads
 * those variables, so the cursor lands pixel-exactly on the tiny controls
 * at any viewport width. The same effect flips `data-hm-in` once (one-shot
 * replay) or parks it true when motion is off. No React state, no Date,
 * no Math.random, and no second copy of the app-mock cursor machinery.
 * ------------------------------------------------------------------ */
function useHeroPanelGeometry(panelRef: { current: HTMLDivElement | null }) {
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const root = document.documentElement;
    const off = () =>
      root.classList.contains('reduce-motion') ||
      root.dataset.art === 'off' ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (off() || !('IntersectionObserver' in window)) {
      panel.setAttribute('data-hm-in', 'true');
    }

    /* SOURCE MATH — the cursor is absolute inside .hm-desktop (position:relative).
       An absolutely positioned child's origin is the panel's PADDING box, while
       getBoundingClientRect() reports the BORDER box. clientLeft/clientTop are
       exactly the 1px hairline, so (rect.left + clientLeft, rect.top + clientTop)
       converts viewport pixels into the panel's own coordinate space. Every
       target centre below is therefore pixel-exact at any viewport width.
       The plus button is position:relative in hero-panels.css, so its popover
       and click ring share that same 13×13 box — no composer-card offset. */
    let live = true;
    const place = () => {
      if (!live) return;
      const pr = panel.getBoundingClientRect();
      const ox = pr.left + panel.clientLeft;
      const oy = pr.top + panel.clientTop;
      const targets: [string, string][] = [
        ['input', '.hpx-compose-input'],
        ['plus', '.hpx-plus'],
        ['send', '.hpx-send'],
      ];
      for (const [name, selector] of targets) {
        const el = panel.querySelector<HTMLElement>(selector);
        if (!el) continue;
        const box = el.getBoundingClientRect();
        panel.style.setProperty(`--hm-c-${name}-x`, `${Math.round(box.left + box.width / 2 - ox)}px`);
        panel.style.setProperty(`--hm-c-${name}-y`, `${Math.round(box.top + box.height / 2 - oy)}px`);
      }
    };
    place();
    /* Re-measure on the first frame and once after fonts settle: the miniature
       is sized in em, so a late font swap would otherwise leave the cursor
       landing a few pixels off the controls. Index-derived, never random. */
    const raf = requestAnimationFrame(place);
    document.fonts?.ready.then(() => { if (live) place(); });
    window.addEventListener('resize', place);

    let io: IntersectionObserver | undefined;
    if (!off()) {
      io = new IntersectionObserver(
        ([entry]) => panel.setAttribute('data-hm-in', entry.isIntersecting ? 'true' : 'false'),
        { threshold: 0.25 },
      );
      io.observe(panel);
    }
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      io?.disconnect();
    };
  }, [panelRef]);
}

function HeroMosaic() {
  const { tx, lang } = useLang();
  const deskRef = useRef<HTMLDivElement>(null);
  useHeroPanelGeometry(deskRef);
  /* v11.43 — ONE beat unit = --art-cadence(2.8s)/7 = 400ms. Every reveal in
     the Desktop miniature reads --hb from these CSSProperties, so the typed
     prompt, both writes and the preview share the exact existing cadence. */
  const hb = (u: number) => ({ '--hb': `${(u * 2800) / 7}ms` } as CSSProperties);
  const alt = tx(
    'An editorial mosaic of six miniature SADEEM windows — desktop, editor, terminal, CLI, schedule and mobile — arranged as a crafted collage on a near-black canvas, anchored by the lime square and black gear mark.',
    'فسيفساء تحريرية من ست نوافذ مصغّرة لسديم — سطح المكتب، المحرر، الطرفية، سطر الأوامر، الجدولة، والهاتف — مرتبة ككلّ مصمّم على لوحة داكنة، ترتكز على المربع الليموني وعلامة الترس السوداء.',
  );

  return (
    <div className="hm-grid" role="img" aria-label={alt}>
      {/* v11.45 · SIGNATURE — the calibration dial. Exactly 145 hairline ticks,
          one per real SADEEM tool; 145 = 5 × 29, so every 29th is a major
          division and every 5th a subdivision. Pure SVG geometry, drawn once
          then breathing. It bleeds behind the display type and the panels and
          is visible only in the negative space. No image, no filter, no glow. */}
      <svg className="hm-dial" viewBox="0 0 1000 1000" fill="none" focusable="false" aria-hidden="true">
        <g className="hm-dial-ink">
          <circle className="hm-dial-ring" cx="500" cy="500" r="470" pathLength={1000} />
          <circle className="hm-dial-ring hm-dial-ring--in" cx="500" cy="500" r="404" pathLength={1000} />
          {Array.from({ length: 145 }, (_, i) => {
            const major = i % 29 === 0;
            const mid = i % 5 === 0;
            return (
              <line
                key={i}
                className={'hm-dial-tick' + (major ? ' is-major' : mid ? ' is-mid' : '')}
                style={{ '--i': i } as CSSProperties}
                x1="500" y1="30" x2="500" y2={major ? 96 : mid ? 68 : 50}
                transform={`rotate(${(i * 360) / 145} 500 500)`}
                pathLength={1}
              />
            );
          })}
          <line className="hm-dial-index" x1="500" y1="14" x2="500" y2="44" pathLength={1} />
        </g>
      </svg>
      {/* tabular margin metadata — a technical drawing's rulers, not labels */}
      <div className="hm-rail hm-rail-left mono" aria-hidden="true">
        <span className="hm-rail-cap">145</span>
        <span className="hm-rail-line" />
        <span>1:1</span>
      </div>
      <div className="hm-rail hm-rail-right mono" aria-hidden="true">
        <span>01—06</span>
        <span className="hm-rail-line" />
        <span>CLI</span>
      </div>
      {/* the engraved top rule draws once from the left, then the signal path
          traces PROMPT → TOOLS → VERIFIED OUTPUT across the instrument. */}
      <span className="hm-rule hm-rule--head hm-rule-draw" aria-hidden="true"
        style={{ '--rule-at': '260ms' } as CSSProperties} />
      <div className="hm-signal mono" aria-hidden="true">
        <svg className="hm-signal-svg" viewBox="0 0 1000 34" preserveAspectRatio="none" focusable="false">
          <path className="hm-signal-track" d="M4 23 H250 V11 H750 V23 H996" vectorEffect="non-scaling-stroke" />
          <path className="hm-signal-live" d="M4 23 H250 V11 H750 V23 H996"
            pathLength={1000} vectorEffect="non-scaling-stroke" />
          {[4, 250, 750, 996].map((x, i) => (
            <circle key={x}
              className={'hm-signal-node' + (i === 0 || i === 3 ? ' is-anchor' : '')}
              cx={x} cy={i === 1 || i === 2 ? 11 : 23} r="2"
              style={{ '--n': i } as CSSProperties} />
          ))}
        </svg>
        <span className="hm-signal-meta">01 / 145 / 06</span>
      </div>
      {/* 0 — the visual anchor: official lime square, black gear, hairline index */}
      <div className="hm-head" aria-hidden="true">
        <svg className="hm-mark" viewBox="0 0 100 100" fill="none" focusable="false">
          <rect x="1" y="1" width="98" height="98" rx="3" fill={LIME} />
          <g transform="translate(14 14) scale(.72)" fill={BLACK}>
            <rect x="31" y="31" width="38" height="38" />
            <path d="M38 31 43 7 48 31Z" />
            <path d="M52 31 57 7 62 31Z" />
            <path d="M38 69 43 93 48 69Z" />
            <path d="M52 69 57 93 62 69Z" />
            <path d="M31 38 7 43 31 48Z" />
            <path d="M31 52 7 57 31 62Z" />
            <path d="M69 38 93 43 69 48Z" />
            <path d="M69 52 93 57 69 62Z" />
          </g>
        </svg>
        <span className="hm-head-label mono">{tx(HM.head[0], HM.head[1])}</span>
        <span className="hm-head-line" />
        <span className="hm-head-src mono">{tx(HM.source[0], HM.source[1])}</span>
      </div>

      <div className="hm-scene" aria-hidden="true">
        {/* 1 — DESKTOP: a faithful miniature of the real SADEEM shell —
            horizontal numbered rail, chat LEFT (plan hairline, real tool rows
            + editor sliver + context orb + typed composer), work area RIGHT
            with the live preview. v11.43 scripts one full run: type → two
            write_file rows → preview. The single cursor is measured from this
            panel's own rendered geometry (useHeroPanelGeometry). */}
        <div className="hm-panel hm-desktop" ref={deskRef} data-hm-dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <header className="hm-panel-top mono">
            <span className="hm-panel-no">01</span>
            <span>{tx(HM.panels[0][0], HM.panels[0][1])}</span>
            <span className="hm-panel-dots"><i /><i /><i /></span>
          </header>
          <div className="hm-app">
            <div className="hm-app-title mono">
              <span className="hm-app-dots"><i /><i /><i /></span>
              <span>{tx(DEMO.window[0], DEMO.window[1])}</span>
            </div>
            {/* Rail.tsx — primary cluster with its real numbers + Files +
                More, utility cluster pinned to the physical right. LTR. */}
            <div className="hm-app-rail" dir="ltr">
              <span className="hpx-rail-left">
                {DEMO.nav.map((item, i) => (
                  <span
                    key={item.no || item.glyph}
                    className={'hpx-rail-btn' + (i === 1 ? ' is-active' : '')}
                    title={tx(item.en, item.ar)}
                  >
                    <AppGlyph name={item.glyph} size={9} />
                    {item.no && <span className="hpx-rail-no mono">{item.no}</span>}
                    {i === 3 && <i className="hpx-rail-dot" />}
                  </span>
                ))}
                <span className="hpx-rail-btn hpx-rail-more" title={tx(DEMO.moreHint[0], DEMO.moreHint[1])}>
                  <AppGlyph name="more" size={9} />
                </span>
              </span>
              <span className="hpx-rail-gap" />
              <span className="hpx-rail-right">
                {DEMO.utils.map((u) => (
                  <span key={u.en} className="hpx-rail-btn" title={tx(u.en, u.ar)}>
                    <AppGlyph name={u.glyph} size={9} />
                  </span>
                ))}
              </span>
            </div>
            <div className="hm-app-main">
              {/* ChatPanel.tsx → MessageView.tsx → Composer.tsx */}
              <div className="hm-app-chat">
                <div className="hpx-chat-head mono">
                  <span className="hpx-chat-brand">S</span>
                  <span className="hpx-chat-label">{tx(DEMO.consoleLabel[0], DEMO.consoleLabel[1])}</span>
                  <span className="hpx-chat-title" title={tx(DEMO.session[0], DEMO.session[1])}>
                    {tx(DEMO.session[0], DEMO.session[1])}
                  </span>
                  <span className="hpx-chat-status"><i /><i /><i /></span>
                </div>
                {/* v11.43 — the plan/progress hairline: one 1px track + pips. */}
                <div className="hpx-plan mono" dir="ltr" aria-hidden="true" style={hb(10)}>
                  <span className="hpx-plan-kicker">{tx('PLAN', 'خطة')}</span>
                  <span className="hpx-plan-track"><i /></span>
                  <span className="hpx-plan-count">2/2</span>
                  <span className="hpx-plan-pips"><i /><i /><i /></span>
                </div>
                <div className="hpx-stream">
                  <div className="hm-app-msg mono hpx-beat" style={hb(11)}>
                    <span className="hpx-typed" style={hb(11)}>{tx('build a website', 'ابنِ موقعاً')}</span><i className="hpx-caret" />
                  </div>
                  <div className="hpx-agent">
                    <span className="hpx-agent-gutter" />
                    <div className="hpx-agent-body">
                      <span className="hpx-reason mono hpx-beat" style={hb(11)}>{tx('Reuse the existing theme', 'إعادة استخدام الثيم الحالي')}</span>
                      {/* the real tool row: 1px rail + verb + path + OK/dur */}
                      <div className="hm-app-tool mono hpx-beat" style={hb(11)} title={DEMO.toolPath}>
                        <span className="hpx-tool-glyph"><AppGlyph name="file" size={8} /></span>
                        <span className="hpx-tool-verb">{DEMO.toolName}</span>
                        <span className="hpx-tool-path">{DEMO.toolPath}</span>
                        <span className="hm-ok">{tx(DEMO.toolOk[0], DEMO.toolOk[1])} <span className="hpx-tool-dur">{DEMO.toolDuration}</span></span>
                      </div>
                      {/* v11.43 — the two visible writes, one hairline row each */}
                      <div className="hm-app-tool mono hpx-tool--write hpx-beat" style={hb(12)}>
                        <span className="hpx-tool-glyph"><AppGlyph name="file" size={8} /></span>
                        <span className="hpx-tool-verb">write_file</span>
                        <span className="hpx-tool-path">index.html</span>
                        <span className="hm-ok">{tx(DEMO.toolOk[0], DEMO.toolOk[1])} <span className="hpx-tool-dur">214ms</span></span>
                      </div>
                      <div className="hm-app-tool mono hpx-tool--write hpx-beat" style={hb(14)}>
                        <span className="hpx-tool-glyph"><AppGlyph name="file" size={8} /></span>
                        <span className="hpx-tool-verb">write_file</span>
                        <span className="hpx-tool-path">styles.css</span>
                        <span className="hm-ok">{tx(DEMO.toolOk[0], DEMO.toolOk[1])} <span className="hpx-tool-dur">96ms</span></span>
                      </div>
                      {/* editor sliver — the written file with real line numbers */}
                      <div className="hpx-sliver mono hpx-beat" style={hb(13)} dir="ltr">
                        <span><i>01</i>&lt;!doctype html&gt;</span>
                        <span><i>02</i>&lt;title&gt;Built with SADEEM&lt;/title&gt;</span>
                        <span className="hpx-sliver-add"><i>03</i>&lt;link rel="stylesheet" href="styles.css"&gt;</span>
                      </div>
                      <span className="hpx-tool-rule" />
                    </div>
                  </div>
                </div>
                <div className="hpx-composer">
                  <div className="hpx-composer-card">
                    <div className="hpx-modes mono">
                      {['BUILD', 'PLAN', 'DEBUG', 'REVIEW'].map((m, i) => (
                        <span key={m} className={i === 0 ? 'is-active' : ''}>{m}</span>
                      ))}
                    </div>
                    <div className="hpx-compose-input mono">
                      <span className="hpx-typed" style={hb(1)}>{tx('build a website', 'ابنِ موقعاً')}</span>
                      <i className="hpx-caret" />
                    </div>
                    <div className="hpx-compose-row">
                      <span className="hpx-plus" title={tx(DEMO.attachPlus[0], DEMO.attachPlus[1])}>
                        <AppGlyph name="plus" size={9} />
                        {/* AttachMenu.tsx — one hairline popover, four paths */}
                        <span className="hpx-attach-pop" aria-hidden="true">
                          <span className="hpx-attach-head mono">Add to chat<i className="mono">4</i></span>
                          <span className="hpx-attach-row"><AppGlyph name="image" size={8} />{tx('Attach image (vision)', 'صورة (رؤية)')}</span>
                          <span className="hpx-attach-row"><AppGlyph name="file" size={8} />{tx('Attach document', 'مستند')}</span>
                          <span className="hpx-attach-row"><AppGlyph name="presets" size={8} />{tx('Prompt presets', 'توجيهات جاهزة')}</span>
                          <span className="hpx-attach-row"><AppGlyph name="rewind" size={8} />{tx('Rewind to a checkpoint', 'الرجوع إلى نقطة حفظ')}</span>
                        </span>
                        {/* the click ripple is a TRANSITION, not a second keyframe */}
                        <span className="hpx-click" aria-hidden="true"><i /></span>
                      </span>
                      <span className="hpx-mic" title={tx(DEMO.voice[0], DEMO.voice[1])}><AppGlyph name="mic" size={9} /></span>
                      {/* ContextLens.tsx compact orb: exact arc + 12-o'clock tick */}
                      <span className="hpx-orb" title={tx(DEMO.ctxLabel[0], DEMO.ctxLabel[1])} aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" shapeRendering="geometricPrecision">
                          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1" opacity=".32" vectorEffect="non-scaling-stroke" />
                          <path d="M12 1.2v2.4" stroke="currentColor" strokeWidth="1" opacity=".55" vectorEffect="non-scaling-stroke" />
                          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" pathLength={100} strokeDasharray="62 100" strokeLinecap="butt" transform="rotate(-90 12 12)" vectorEffect="non-scaling-stroke" />
                          <text className="hpx-ctx-value" x="12" y="12.7" textAnchor="middle">{DEMO.ctxValue}</text>
                        </svg>
                      </span>
                      <span className="hpx-effort mono"><AppGlyph name="spark" size={7} /><span>{tx(DEMO.effort[0], DEMO.effort[1])}</span><span className="hpx-effort-value">{tx(DEMO.effortValue[0], DEMO.effortValue[1])}</span></span>
                      <span className="hpx-model mono" dir="ltr">{DEMO.model}</span>
                      <span className="hpx-send" title={tx(DEMO.send[0], DEMO.send[1])}>
                        <AppGlyph name="send" size={9} />
                        {/* the Send click ripple: a TRANSITION on the same gate */}
                        <span className="hpx-send-click" aria-hidden="true"><i /></span>
                      </span>
                    </div>
                    <div className="hpx-quick mono" aria-hidden="true">
                      {DEMO.quickCommands.slice(0, 4).map((q) => <span key={q}>{q}</span>)}
                    </div>
                  </div>
                </div>
              </div>
              {/* v11.43 — the work area opens the real PreviewArea replica:
                  breadcrumb → URL bar → rendered mini page → verified stamp. */}
              <div className="hm-app-work mono">
                <div className="hpx-work-head mono" dir="ltr">
                  <span className="hpx-crumb">sadeem-demo<span className="hpx-crumb-sep">›</span>index.html</span>
                  <span className="hpx-work-meta">+2</span>
                </div>
                <div className="hpx-preview mono" dir="ltr" style={hb(16)}>
                  <div className="hpx-pv-bar">
                    <span className="hpx-pv-eyebrow">{tx('LIVE PREVIEW', 'معاينة حية')}</span>
                    <span className="hpx-pv-status"><i />{tx('READY', 'جاهز')}</span>
                  </div>
                  <div className="hpx-pv-url" dir="ltr">
                    <i className="hpx-pv-led" />
                    <span className="hpx-pv-addr">localhost:5173</span>
                    <span className="hpx-pv-acts" aria-hidden="true">↻&nbsp;&nbsp;↗</span>
                  </div>
                  <div className="hpx-pv-canvas" dir="ltr">
                    <div className="hpx-pv-page">
                      <div className="hpx-pv-nav">
                        <span className="hpx-pv-logo">◆ S</span>
                        <span>{tx('HOME · DOCS · ABOUT', 'الرئيسية · التوثيق · حول')}</span>
                        <span className="hpx-pv-cta">{tx('Get started', 'ابدأ الآن')}</span>
                      </div>
                      <div className="hpx-pv-hero">
                        <span className="hpx-pv-kicker">{tx('BUILT WITH SADEEM', 'بُني بسديم')}</span>
                        <span className="hpx-pv-h1">{tx('Ship the site.', 'أطلق الموقع.')}</span>
                        <span className="hpx-pv-lead">{tx('A real page, rendered locally — nav, headline and cards.', 'صفحة حقيقية تُعرض محلياً — شريط تنقل وعنوان وبطاقات.')}</span>
                      </div>
                      <div className="hpx-pv-cards">
                        <span><i /><b>{tx('Fast by default', 'سريع افتراضياً')}</b><em /></span>
                        <span><i /><b>{tx('Local first', 'محلي أولاً')}</b><em /></span>
                      </div>
                    </div>
                  </div>
                  <div className="hpx-pv-stamp">
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M3 8.4 6.3 11.7 13 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>{tx('verified', 'تم التحقق')}</span>
                    <span className="hpx-pv-stamp-rule" />
                    <span>· 200 OK</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* ONE cursor: measured landings, eased waypoints, a real dwell. */}
          <span className="hpx-cursor" aria-hidden="true">
            <svg viewBox="0 0 20 24" fill="none" shapeRendering="geometricPrecision">
              <path
                d="M1.2 1.4 1.2 17.3 5.4 13.2 8.1 20.7 11.1 19.3 8.4 11.9 14.8 11.9Z"
                fill="currentColor" stroke={BLACK} strokeWidth="1.2" strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </span>
        </div>

        {/* 2 — EDITOR: real file tabs, line numbers, a +/− diff hairline */}
        <div className="hm-panel hm-editor">
          <header className="hm-panel-top mono">
            <span className="hm-panel-no">02</span>
            <span>{tx(HM.panels[1][0], HM.panels[1][1])}</span>
            <span className="hm-panel-dots"><i /><i /><i /></span>
          </header>
          <div className="hpx-tabs mono" dir="ltr">
            <span className="hpx-tab is-active"><AppGlyph name="file" size={8} />settings/Toggle.tsx<i>×</i></span>
            <span className="hpx-tab">theme-context.ts</span>
            <span className="hpx-tab">PLAYBOOK.md</span>
          </div>
          <div className="hpx-breadcrumb mono" dir="ltr">
            <span>settings</span><span className="hpx-crumb-sep">›</span><span>Toggle.tsx</span>
            <span className="hpx-diffstat">+12 −3</span>
          </div>
          <div className="hm-code mono" dir="ltr">
            <span><i>17</i><b>import</b> {'{ useTheme }'} <b>from</b> './theme-context'</span>
            <span><i>18</i></span>
            <span className="hpx-code-del"><i>19</i>− const [dark, setDark] = useState(false);</span>
            <span className="hm-code-add"><i>20</i>+ const [theme, setTheme] = useTheme();</span>
            <span><i>21</i>&nbsp; return &lt;Toggle checked={'{theme === "dark"}'} /&gt;;</span>
          </div>
          <div className="hpx-minimap" aria-hidden="true"><i /><i /><i className="is-add" /><i /><i /></div>
          <div className="hm-editor-status mono">
            <span>TSX</span><span>UTF-8</span><span>Ln 20, Col 9</span><span>Spaces: 2</span>
          </div>
        </div>

        {/* 3 — CLI: a tiny terminal with the real command + output lines */}
        <div className="hm-panel hm-cli">
          <header className="hm-panel-top mono">
            <span className="hm-panel-no">03</span>
            <span>{tx(HM.panels[3][0], HM.panels[3][1])}</span>
            <span className="hm-panel-dots"><i /><i /><i /></span>
          </header>
          <div className="hpx-cli-bar mono" dir="ltr">
            <span>agent@workspace</span><span className="hpx-cli-cwd">~/sadeem</span><span>zsh</span>
          </div>
          {/* v11.44 — the SHIPPED CLI: the real npm package name (`sadeem-cli`,
              see root package.json) and a quoted single-task `sadeem run`,
              exactly as documented. Still a compact, honest terminal panel. */}
          <div className="hm-cli-body mono" dir="ltr">
            <span><i>$</i> npm i -g sadeem-cli</span>
            <span className="hm-dim">  + sadeem-cli@11.12.1</span>
            <span><i>$</i> sadeem run "fix the flaky test"</span>
            <span className="hm-dim">  ↳ read_file settings/theme-context.ts</span>
            <span className="hm-ok">  ✓ 2 tools · 512ms</span>
            <span><i>$</i> sadeem preview</span>
            <span className="hm-ok">  → http://localhost:5173</span>
            <span><i>$</i> <i className="hpx-cli-caret" /></span>
          </div>
        </div>

        {/* 4 — TERMINAL: a dev server's honest loopback output */}
        <div className="hm-panel hm-terminal">
          <header className="hm-panel-top mono">
            <span className="hm-panel-no">04</span>
            <span>{tx(HM.panels[2][0], HM.panels[2][1])}</span>
            <span className="hm-panel-dots"><i /><i /><i /></span>
          </header>
          <div className="hm-term-body mono" dir="ltr">
            <span><i>›</i> npm run dev</span>
            <span className="hm-dim">  VITE ready in 214 ms</span>
            <span className="hm-ok">  ➜ Local: http://localhost:5173/</span>
            <span className="hm-dim">  press h + enter for help</span>
          </div>
        </div>

        {/* 5 — MOBILE: a small phone with a pairing code */}
        <div className="hm-panel hm-mobile">
          <header className="hm-panel-top mono">
            <span className="hm-panel-no">05</span>
            <span>{tx(HM.panels[5][0], HM.panels[5][1])}</span>
            <span className="hm-panel-dots"><i /><i /><i /></span>
          </header>
          <div className="hm-phone">
            <span className="hm-phone-notch" />
            <span className="hm-phone-letter" aria-hidden="true">S</span>
            <span className="hm-phone-state mono">{tx(HM.paired[0], HM.paired[1])}</span>
            <span className="hm-phone-code mono" dir="auto">{tx(HM.pairCode[0], HM.pairCode[1])}</span>
            <span className="hm-phone-btn mono">CONNECT</span>
            <span className="hm-phone-home" />
          </div>
        </div>

        {/* 6 — SCHEDULE: a quiet cron row, real syntax and honest states */}
        <div className="hm-panel hm-schedule">
          <header className="hm-panel-top mono">
            <span className="hm-panel-no">06</span>
            <span>{tx(HM.panels[4][0], HM.panels[4][1])}</span>
            <span className="hm-panel-dots"><i /><i /><i /></span>
          </header>
          <div className="hm-cron">
            <div className="hm-cron-row mono">
              <i className="hm-cron-led" />
              <span className="hm-cron-expr" dir="ltr">0 9 * * 1</span>
              <span className="hm-cron-label">{tx(HM.daily[0], HM.daily[1])}</span>
              <span className="hm-cron-state">{tx(HM.ready[0], HM.ready[1])}</span>
            </div>
            <div className="hm-cron-row mono">
              <i className="hm-cron-led" />
              <span className="hm-cron-expr" dir="ltr">30 18 * * 5</span>
              <span className="hm-cron-label">{tx(HM.weekly[0], HM.weekly[1])}</span>
              <span className="hm-cron-state">{tx(HM.ready[0], HM.ready[1])}</span>
            </div>
          </div>
        </div>
        {/* the seventh cell is deliberately EMPTY space: a measured scale that
            balances the wide schedule strip instead of another feature card. */}
        <div className="hm-gauge mono" aria-hidden="true">
          <span className="hm-gauge-num">145</span>
          <span className="hm-gauge-scale">{Array.from({ length: 29 }, (_, i) => <i key={i} />)}</span>
          <span className="hm-gauge-meta">1:1</span>
        </div>
      </div>
      <span className="hm-rule hm-rule--foot hm-rule-draw" aria-hidden="true"
        style={{ '--rule-at': '1320ms' } as CSSProperties} />

      {/* the quiet "works with" row — real provider names, not fake logos */}
      <div className="hm-foot mono" aria-hidden="true">
        <span className="hm-foot-line" />
        <span>{tx(HM.providers[0], HM.providers[1])}</span>
        <span className="hm-foot-ver">v{SITE.version}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * ICON FIDELITY (v11.40) — the mock must not invent glyphs.
 * Lucide entries use the EXACT names Rail.tsx / ChatPanel.tsx / Composer.tsx
 * import. The entries marked "icons.tsx" copy that file's path/circle/rect
 * data verbatim, so the shape is literally the same drawing.
 * ------------------------------------------------------------------ */
type GlyphShape =
  | { k: 'path'; d: string; o?: number; f?: boolean }
  | { k: 'rect'; x: number; y: number; w: number; h: number; r?: number; o?: number }
  | { k: 'circle'; cx: number; cy: number; r: number; o?: number };
type GlyphDef = { lucide?: LucideIcon; shapes?: GlyphShape[] };
const p = (d: string, o?: number, f?: boolean): GlyphShape => ({ k: 'path', d, ...(o === undefined ? {} : { o }), ...(f === undefined ? {} : { f }) });
const r = (x: number, y: number, w: number, h: number, ro?: number, o?: number): GlyphShape => ({ k: 'rect', x, y, w, h, ...(ro === undefined ? {} : { r: ro }), ...(o === undefined ? {} : { o }) });
const c = (cx: number, cy: number, rad: number, o?: number): GlyphShape => ({ k: 'circle', cx, cy, r: rad, ...(o === undefined ? {} : { o }) });

/* Rail.tsx maps BOTH `dna` (06) and `signature` (16) to icons.tsx IcDna. */
const DNA_SHAPES: GlyphShape[] = [
  p('M7.5 3c0 4.7 9 4.3 9 9s-9 4.3-9 9'),
  p('M16.5 3c0 4.7-9 4.3-9 9s9 4.3 9 9', .5),
  p('M9.4 5.8h5.2M9.4 18.2h5.2M8.4 10.4h7.2M8.4 13.6h7.2', .8),
];

const GLYPHS: Record<string, GlyphDef> = {
  /* Rail.tsx — lucide imports (exact identifiers) */
  home: { lucide: House },
  flows: { lucide: Workflow },
  skills: { lucide: Blocks },
  artifacts: { lucide: BadgeCheck },
  wiki: { lucide: BookOpen },
  prompts: { lucide: Quote },
  subagents: { lucide: UsersRound },
  files: { lucide: Files },
  more: { lucide: MoreHorizontal },
  settings: { lucide: Settings2 },
  keyboard: { lucide: Keyboard },
  plans: { lucide: CalendarDays },
  security: { lucide: ShieldCheck },
  folder: { lucide: FolderOpen },
  layout: { lucide: LayoutGrid },
  /* ChatPanel.tsx — control cluster (exact lucide names) */
  recap: { lucide: Download },
  review: { lucide: ShieldCheck },
  compact: { lucide: Shrink },
  newSession: { lucide: MessageSquarePlus },
  sessionsList: { lucide: MessageSquare },
  wrench: { lucide: Wrench },
  chevron: { lucide: ChevronDown },
  close: { lucide: X },
  /* Composer.tsx / AttachMenu.tsx / ContextLens.tsx (exact lucide names) */
  mic: { lucide: Mic },
  presets: { lucide: BookMarked },
  rewind: { lucide: History },
  check: { lucide: Check },
  gauge: { lucide: Gauge },
  copy: { lucide: Copy },
  /* icons.tsx — verbatim in-house geometry (no invented shapes) */
  workspace: { shapes: [p('M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2c.4 0 .8.16 1.06.44L11.5 6.7H19A1.5 1.5 0 0 1 20.5 8.2v9.3A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5V6.5Z'), p('M3.5 10h17', .55)] },
  sessions: { shapes: [r(3.5, 4.5, 13, 15, 1.6), r(9, 7.5, 11.5, 12, 1.6, .55)] },
  git: { shapes: [c(6.5, 6, 2.2), c(6.5, 18, 2.2), c(17.5, 12, 2.2), p('M6.5 8.2v7.6', .7), p('M8.7 6h4.3a2 2 0 0 1 2 2v2.2', .7), p('M15 13.8V16a2 2 0 0 1-2 2H8.7', .7)] },
  mcp: { shapes: [r(3.5, 3.5, 7, 7, 1.4), r(13.5, 3.5, 7, 7, 1.4, .55), r(3.5, 13.5, 7, 7, 1.4, .55), r(13.5, 13.5, 7, 7, 1.4), p('M10.5 7h3', .45), p('M7 10.5v3', .45), p('M17 10.5v3', .45), p('M10.5 17h3', .45)] },
  usage: { shapes: [p('M4 19.5h16', .5), r(5.5, 12, 3, 5, .8), r(10.5, 8.5, 3, 8.5, .8), r(15.5, 5, 3, 12, .8, .6)] },
  dna: { shapes: DNA_SHAPES },
  search: { shapes: [c(10.8, 10.8, 5.3), p('m15 15 4.5 4.5')] },
  preview: { shapes: [r(3.5, 4.5, 17, 15, 1.8), p('M3.5 8.5h17', .6), p('M7 6.5h.01', .6), p('M9.2 6.5h.01', .6), p('M9 16.2v-4.4l3.8 2.2L9 16.2Z', .8, true)] },
  terminal: { shapes: [r(3.5, 4.5, 17, 15, 1.8), p('m7.5 10 2.6 2.4-2.6 2.4'), p('M12.6 15h4')] },
  library: { shapes: [p('M4 19.5A2.5 2.5 0 0 1 6.5 17H20'), p('M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z')] },
  plus: { shapes: [p('M12 5v14M5 12h14')] },
  spark: { shapes: [p('M12 3.5c.7 4.4 2.6 6.3 7 7-4.4.7-6.3 2.6-7 7-.7-4.4-2.6-6.3-7-7 4.4-.7 6.3-2.6 7-7Z'), p('M18.8 15.8c.3 1.9 1.1 2.7 3 3-1.9.3-2.7 1.1-3 3-.3-1.9-1.1-2.7-3-3 1.9-.3 2.7-1.1 3-3Z', .7)] },
  send: { shapes: [p('M4.5 12 20 4.5 15.8 20l-3.9-5.6L4.5 12Z'), p('M11.9 14.4 20 4.5', .6)] },
  file: { shapes: [p('M6 3.5h7L18.5 9v11a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5v-16a.5.5 0 0 1 .5-.5Z'), p('M13 3.5V9h5.5', .6)] },
  image: { shapes: [r(3.5, 4.5, 17, 15, 1.8), c(8.6, 9.6, 1.7), p('m4.5 17.5 4.6-4.6a1.4 1.4 0 0 1 2 0l6.4 6.4', .8), p('M14.5 16l1.9-1.9a1.4 1.4 0 0 1 2 0l2.1 2.1', .8)] },
  signature: { shapes: DNA_SHAPES },
};

/** One glyph renderer: lucide when the real source imports lucide, verbatim
 *  SVG shape data otherwise. Never picks a shape that is not in GLYPHS. */
function AppGlyph({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const g = GLYPHS[name];
  if (!g) return null;
  if (g.lucide) {
    const Ico = g.lucide;
    return <Ico size={size} strokeWidth={1.7} className={className} aria-hidden="true" />;
  }
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(g.shapes ?? []).map((s, i) => {
        if (s.k === 'path') {
          return <path key={i} d={s.d} opacity={s.o} fill={s.f ? 'currentColor' : 'none'} stroke={s.f ? 'none' : undefined} />;
        }
        if (s.k === 'rect') {
          return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} opacity={s.o} />;
        }
        return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} opacity={s.o} />;
      })}
    </svg>
  );
}

export default function Home() {
  const { tx } = useLang();

  return (
    <>
      {/* 1 — HERO (v11.41): centred headline + honest line, then the MOSAIC
          as the centrepiece. Same copy, tighter rhythm, no bloom/plate. */}
      <section className="hero wrap" aria-labelledby="hero-title">
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="hero-rule hero-rule-enter" aria-hidden="true" style={{ '--d': '0ms' } as CSSProperties} />
            <span className="label hero-eyebrow hero-enter" style={{ '--d': '80ms' } as CSSProperties}>
              {tx(HERO.eyebrow[0], HERO.eyebrow[1])}
            </span>
            <h1 className="display hero-title" id="hero-title">
              <span className="hero-line hero-enter" style={{ '--d': '160ms' } as CSSProperties}>
                {tx(HERO.line1[0], HERO.line1[1])}
              </span>
              <span className="hero-line hero-enter" style={{ '--d': '250ms' } as CSSProperties}>
                {tx(HERO.line2[0], HERO.line2[1])}<em className="accent">{tx(HERO.line3[0], HERO.line3[1])}</em>
              </span>
            </h1>
            <p className="lead hero-lead hero-enter" style={{ '--d': '340ms' } as CSSProperties}>
              {tx(HERO.lead[0], HERO.lead[1])}
            </p>
            {/* v11.42 — two distinct CTAs in one flex row: solid lime primary,
                hairline outline secondary, bilingual labels, no overlap. */}
            <div className="hero-actions hero-enter" style={{ '--d': '440ms' } as CSSProperties}>
              <Link className="btn btn-solid" href="/download">
                <ArrowDownToLine size={17} />{tx(HERO.cta[0], HERO.cta[1])}
              </Link>
              <Link className="btn hero-more" href="/docs">
                {tx(HERO.more[0], HERO.more[1])}<ArrowUpRight size={14} />
              </Link>
            </div>
            <p className="hero-note label hero-enter" style={{ '--d': '520ms' } as CSSProperties}>
              <span className="mono">v{SITE.version}</span> · {tx(HERO.note[0], HERO.note[1])}
            </p>
          </div>

          <div className="hero-art">
            <figure className="hero-mosaic hero-art-enter" style={{ '--d': '460ms' } as CSSProperties}>
              <div className="hero-mat">
                <HeroMosaic />
              </div>
              <div className="hm-index mono" aria-hidden="true">
                {tx('DESKTOP · EDITOR · TERMINAL · CLI · MOBILE · SCHEDULE', 'سطح المكتب · المحرر · الطرفية · سطر الأوامر · الهاتف · الجدولة')}
              </div>
              <figcaption className="hero-figcap mono">{tx(HERO.artCaption[0], HERO.artCaption[1])}</figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* 3 — THREE BENEFITS: plates, not cards */}
      <section className="section wrap benefits-sec" id="principles" aria-labelledby="benefits-title">
        <div className="sec-head">
          <div className="sec-index">{tx(BENEFITS.index[0], BENEFITS.index[1])}</div>
          <div className="sec-body">
            <span className="label">{tx(BENEFITS.label[0], BENEFITS.label[1])}</span>
            <h2 className="h2" id="benefits-title" style={{ marginTop: 16 }}>
              {tx(BENEFITS.title1[0], BENEFITS.title1[1])} <em className="accent italic">{tx(BENEFITS.title2[0], BENEFITS.title2[1])}</em>
            </h2>
          </div>
        </div>

        <div className="benefit-list">
          {BENEFITS.items.map((item, i) => (
            <article className="benefit" key={item.no}>
              <div className="benefit-copy">
                <span className="benefit-no mono">{item.no} — {tx(item.tag[0], item.tag[1])}</span>
                <h3 className="h3 benefit-title">{tx(item.title[0], item.title[1])}</h3>
                <p className="benefit-body">{tx(item.body[0], item.body[1])}</p>
              </div>
              <div className="benefit-art">
                {i === 0 ? <LocalDiagram /> : i === 1 ? <PlaybookDiagram /> : <ToolsDiagram />}
                <span className="benefit-fig-cap mono">fig. 0{i + 1}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 4 — PROOF / TRUST: engraved mono figures */}
      <section className="section-tight wrap proof-sec" id="figures" aria-labelledby="proof-title">
        <div className="proof-head">
          <span className="sec-index">{tx(PROOF.index[0], PROOF.index[1])}</span>
          <h2 className="proof-title" id="proof-title">
            {tx(PROOF.title1[0], PROOF.title1[1])} <em className="accent italic">{tx(PROOF.title2[0], PROOF.title2[1])}</em>
          </h2>
        </div>
        <div className="proof-strip">
          {PROOF.figures.map((f) => (
            <div className="proof-item" key={f.en}>
              <span className="proof-num">{f.n}</span>
              <span className="proof-label">{tx(f.en, f.ar)}</span>
            </div>
          ))}
        </div>
        <p className="proof-note label">{tx(PROOF.note[0], PROOF.note[1])}</p>
      </section>

      {/* search / answer-layer content — before the final CTA */}
      <SEOContent />

      {/* 5 — FINAL CTA */}
      <section className="section wrap closing-sec" id="start" aria-labelledby="closing-title">
        <div className="closing">
          <span className="label">{tx(CLOSE.label[0], CLOSE.label[1])}</span>
          <h2 className="display closing-title" id="closing-title">
            {tx(CLOSE.title1[0], CLOSE.title1[1])} <em className="accent italic">{tx(CLOSE.title2[0], CLOSE.title2[1])}</em>
          </h2>
          <p className="lead">{tx(CLOSE.lead[0], CLOSE.lead[1])}</p>
          <div className="hero-actions">
            <Link className="btn btn-solid" href="/download">
              <ArrowDownToLine size={17} />{tx(CLOSE.cta[0], CLOSE.cta[1])}
            </Link>
            <Link className="link" href="/docs">
              {tx(CLOSE.more[0], CLOSE.more[1])}<ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
