'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownToLine, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { SITE } from '@/lib/site';
import { ChunkedDownload } from './ChunkedDownload';

type L = { en: string; ar: string };

/* SIGNATURE ELEMENT — an engraved isometric software box.
   Ink hatching on one face, a seal that orbits the plate reading the real
   version, and a hairline dimension line. Drawn here, no external art. */
/* Three faces of one cube: both ground axes run at tan(30°)=0.573 and the
   third is vertical, so every edge resolves to the same vanishing geometry.
   Lid: A(160,71) B(242,118) C(160,165) D(78,118); height 86 down to the base. */
function ArtifactPlate() {
  const { tx } = useLang();
  /* Hatch lines parallel to the face's own 30° edges, stepped 8px apart so
     the engraving has an even, measurable density (1px strokes). */
  const hatch = Array.from({ length: 11 }, (_, i) => {
    const y = 118 + i * 8;
    return <line key={i} x1={78} y1={y} x2={160} y2={y + 47} />;
  });
  /* The seal text is fitted to the exact circumference, so it tracks the
     circle with no gap or overlap at the seam. */
  const SEAL_R = 134;
  const SEAL_C = 2 * Math.PI * SEAL_R;
  const sealPath = `M160 160m-${SEAL_R} 0a${SEAL_R} ${SEAL_R} 0 1 1 ${SEAL_R * 2} 0a${SEAL_R} ${SEAL_R} 0 1 1-${SEAL_R * 2} 0`;

  return (
    <motion.div
      className="d-fig"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.9, delay: 0.1 }}
    >
      <svg viewBox="0 0 320 320" aria-hidden="true">
        <defs>
          <clipPath id="d-box-left"><polygon points="78,118 160,165 160,251 78,204" /></clipPath>
          <path id="d-seal-path" d={sealPath} />
        </defs>

        {/* faint engraved field */}
        <g stroke="currentColor" fill="none" opacity=".22" strokeWidth=".5">
          <circle cx="160" cy="160" r="141" />
          <circle cx="160" cy="160" r="132" strokeDasharray="1 6" />
          <path d="M160 14v292M14 160h292" />
        </g>

        {/* orbiting seal — the version is a number, not a language string */}
        <g className="d-seal">
          <circle cx="160" cy="160" r={SEAL_R} fill="none" stroke="var(--accent)" strokeWidth=".8" strokeDasharray="3 5" opacity=".7" />
          <text fontSize="10.5" fontFamily="var(--mono)" fill="var(--accent)" textLength={SEAL_C} lengthAdjust="spacing">
            <textPath href="#d-seal-path" startOffset="0">{'11.12.0 · '.repeat(6)}</textPath>
          </text>
        </g>

        {/* the isometric box */}
        <g stroke="currentColor" fill="none" strokeWidth="1.1" strokeLinejoin="round">
          <polygon points="160,71 242,118 160,165 78,118" fill="var(--paper)" />
          <polygon points="78,118 160,165 160,251 78,204" fill="var(--paper)" />
          <polygon points="160,165 242,118 242,204 160,251" fill="var(--paper)" />
          {/* a four-pane mark: four rhombi built from one 24×14 isometric tile,
             sharing the central vertex (160,118) — no gaps, no overlaps */}
          <g strokeWidth=".9" opacity=".8">
            <polygon points="160,90 184,104 160,118 136,104" />
            <polygon points="184,104 208,118 184,132 160,118" />
            <polygon points="160,118 184,132 160,146 136,132" />
            <polygon points="136,104 160,118 136,132 112,118" />
          </g>
        </g>

        {/* ink hatching, clipped to the left face */}
        <g clipPath="url(#d-box-left)" stroke="currentColor" strokeWidth="1" opacity=".38">{hatch}</g>
        <g stroke="var(--accent)" fill="none" strokeWidth="1.3">
          <path d="M160 71 78 118M78 118v86" />
        </g>

        {/* dimension line: extension lines rise from the box's bottom corners
           (x=78 and x=242), so the inward arrowheads meet the edges exactly */}
        <g stroke="currentColor" fill="none" opacity=".75">
          <path d="M78 204v82M242 204v82" strokeWidth=".6" opacity=".45" />
          <path d="M78 272v14M242 272v14M78 279h164" strokeWidth=".7" />
          <path d="M78 279l9-3v6zM242 279l-9-3v6z" fill="currentColor" stroke="none" />
        </g>

        <text x="160" y="304" textAnchor="middle" fontSize="9" fontFamily="var(--mono)" letterSpacing="2.4" fill="var(--faint)">{tx('x64 · v' + SITE.version, 'x64 · v' + SITE.version)}</text>
      </svg>
      <span className="d-fig-label tl">{tx('FIG. 02', 'شكل 02')}</span>
      <span className="d-fig-label br">{tx('ARTIFACT / WINDOWS', 'قطعة / ويندوز')}</span>
    </motion.div>
  );
}

/* Precise 1px platform glyphs — each drawn at the same 16-unit optical
   size (5..21 inside a 26-unit box), square caps, no filled icon tiles. */
function PlatformGlyph({ n }: { n: string }) {
  const common = {
    width: 26,
    height: 26,
    viewBox: '0 0 26 26',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1,
    strokeLinejoin: 'miter' as const,
    strokeLinecap: 'square' as const,
    'aria-hidden': true,
  };
  if (n === '01') {
    return (
      <svg {...common}>
        <rect x="5" y="5" width="7" height="7" />
        <rect x="14" y="5" width="7" height="7" />
        <rect x="5" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </svg>
    );
  }
  if (n === '02') {
    return (
      <svg {...common}>
        <path d="M17 6c-1.9-1.7-4.6-1-5.5.9C8.6 6.8 6.5 9.6 6.5 13c0 4.3 3.6 7.7 8 7.7 2.7 0 4.6-1.7 5.5-3.8.8-1.1 1.6-2 1.6-3.8-1.8 0-3.5-.9-3.5-2.6 0-1.7 1-2.7 2.6-2.7C20.5 7.3 19.4 6.5 17 6z" />
        <path d="M17.4 5.1c.9-1.5 2.5-1.5 3.4-.8-.9.8-1.9 1.5-3.4 1.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M6 8l5 5-5 5" />
      <path d="M13 18h8" />
    </svg>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

type RowProps = {
  n: string;
  title: L;
  kind: L;
  desc: L;
  sha: string;
  href: string;
  cta: L;
  recommended?: boolean;
  // v11.43 — when Blob hosting is unavailable, serve the artifact as static
  // parts from /dl/* and reassemble + SHA-verify in the browser.
  parts?: string[];
  filename?: string;
};

function DownloadRow({ n, title, kind, desc, sha, href, cta, recommended, parts, filename }: RowProps) {
  const { tx } = useLang();
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function onCopy() {
    const ok = await copyText(sha);
    setState(ok ? 'copied' : 'error');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2200);
  }

  const copyLabel = state === 'copied'
    ? tx('Copied', 'تم النسخ')
    : state === 'error'
      ? tx('Copy failed', 'فشل النسخ')
      : tx('Copy hash', 'نسخ البصمة');

  return (
    <motion.div
      className="frow d-row"
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.55 }}
    >
      <span className="frow-num">{n}</span>

      <div>
        <h3 className="h3">{tx(title.en, title.ar)}</h3>
        <p className="label" style={{ marginTop: 10 }}>{tx(kind.en, kind.ar)}</p>
        {recommended && <span className="d-rec">{tx('RECOMMENDED', 'موصى به')}</span>}
        <p className="dim d-desc">{tx(desc.en, desc.ar)}</p>
      </div>

      <details>
        <summary className="label">{tx('Verify checksum', 'تحقّق من البصمة')}</summary>
        <div>
          <div className="d-hash">
            <span className="label">SHA-256</span>
            <code dir="ltr" className={state === 'copied' ? 'is-inverted' : undefined}>{sha}</code>
            <button
              type="button"
              className={'btn btn-sm d-copy' + (state === 'copied' ? ' is-done' : '')}
              onClick={onCopy}
              aria-label={tx('Copy the SHA-256 checksum', 'نسخ بصمة SHA-256')}
            >
              {copyLabel}
            </button>
            <span className="d-sr" role="status" aria-live="polite">
              {state === 'idle' ? '' : copyLabel}
            </span>
          </div>
        </div>
      </details>

      <div>
        {parts && parts.length > 0 && filename ? (
          <ChunkedDownload parts={parts} filename={filename} expectedSha256={sha} className="btn btn-solid btn-block">
            <ArrowDownToLine size={16} aria-hidden="true" />
            {tx(cta.en, cta.ar)}
          </ChunkedDownload>
        ) : (
          <a className="btn btn-solid btn-block" href={href} download>
            <ArrowDownToLine size={16} aria-hidden="true" />
            {tx(cta.en, cta.ar)}
          </a>
        )}
        <p className="d-file" dir="ltr">{fileName(href)}</p>
      </div>
    </motion.div>
  );
}

const BEFORE = [
  {
    n: '01',
    title: { en: 'What the installer does', ar: 'ماذا يفعل المثبّت' },
    body: {
      en: 'The installer adds Start menu and desktop shortcuts and can be removed from Windows Settings. The ZIP runs from its folder without changing system settings.',
      ar: 'يضيف المثبّت اختصارات إلى قائمة ابدأ وسطح المكتب، ويمكن إزالته من إعدادات ويندوز. يعمل الملف المضغوط من مجلده دون تغيير إعدادات النظام.',
    },
    path: { en: 'Windows Settings → Apps', ar: 'إعدادات ويندوز ← التطبيقات' },
  },
  {
    n: '02',
    title: { en: 'Bring your own key', ar: 'أحضر مفتاحك الخاص' },
    body: {
      en: 'SADEEM uses a key from the provider you choose. Add it in Settings → Providers. Your provider bills model calls to that key; the key stays on your device.',
      ar: 'يستخدم سديم مفتاحاً من المزوّد الذي تختاره. أضفه من الإعدادات ← المزوّدون. يحوّل مزوّدك تكلفة استدعاءات النموذج إلى ذلك المفتاح، وتبقى المفاتيح على جهازك.',
    },
    path: { en: 'Settings → Providers', ar: 'الإعدادات ← المزوّدون' },
  },
  {
    n: '03',
    title: { en: 'Free during the public season', ar: 'مجاني خلال الموسم العام' },
    body: {
      en: 'SADEEM is free to download and use during the public season. Model calls are billed by the provider you choose, not by SADEEM.',
      ar: 'يمكن تنزيل سديم واستخدامه مجاناً خلال الموسم العام. تتحمل مزوّدك تكلفة استدعاءات النموذج، لا سديم.',
    },
    path: { en: 'Public season', ar: 'الموسم العام' },
  },
];

const QUICK = [
  {
    n: '01',
    title: { en: 'Install or unzip', ar: 'ثبّت أو فكّ الضغط' },
    body: { en: 'Run the installer, or extract the ZIP and open SADEEM.exe. The ZIP runs from its folder. Confirm the CLI with sadeem version.', ar: 'شغّل المثبّت، أو فكّ الضغط عن الملف المضغوط وافتح SADEEM.exe. يعمل الملف المضغوط من مجلده. تحقق من الأداة الطرفية بـ sadeem version.' },
  },
  {
    n: '02',
    title: { en: 'Add a provider key', ar: 'أضف مفتاح مزوّد' },
    body: { en: 'Add a key from OpenRouter, OpenAI, Anthropic or another supported provider in Settings → Providers. Your provider bills the calls.', ar: 'أضف مفتاحاً من OpenRouter أو OpenAI أو Anthropic أو مزوّد مدعوم آخر من الإعدادات ← المزوّدون. مزوّدك هو الذي يحصّل تكلفة الاستدعاءات.' },
  },
  {
    n: '03',
    title: { en: 'Start without an account', ar: 'ابدأ بلا حساب' },
    body: { en: 'Open a project folder and describe a task. Sign in only when you want to sync settings across devices.', ar: 'افتح مجلد المشروع وصف المهمة. سجّل الدخول فقط عندما تريد مزامنة الإعدادات بين أجهزتك.' },
  },
  {
    n: '04',
    title: { en: 'Review before you keep', ar: 'راجع قبل الإبقاء' },
    body: { en: 'The app shows the plan, the tool calls and the diff. A shadow-commit lets /undo restore files and the conversation if the change goes wrong.', ar: 'يعرض التطبيق الخطة واستدعاءات الأدوات والفروق. تسمح نسخة shadow-commit للأمر /undo بإرجاع الملفات والمحادثة إذا فشل التغيير.' },
  },
];

const FAQS = [
  {
    q: { en: 'Does SADEEM work offline?', ar: 'هل يعمل سديم دون اتصال بالإنترنت؟' },
    a: {
      en: 'The app, its 145 tools and its files run locally, so file and terminal tools work without a network. Inference still needs a provider: connect Ollama or LM Studio for a local model and the agent can keep working offline. Offline-capable, not offline-only.',
      ar: 'التطبيق وأدواته الـ١٤٥ وملفاته تعمل محلياً، لذا تعمل أدوات الملفات والطرفية دون شبكة. الاستنتاج يحتاج مزوّداً: اتصل بـ Ollama أو LM Studio لنموذج محلي فيستطيع الوكيل الاستمرار دون اتصال. قابل للعمل دون اتصال، لا يعمل دون اتصال فقط.',
    },
  },
  {
    q: { en: 'Do I need my own API key?', ar: 'هل أحتاج مفتاح API خاصاً بي؟' },
    a: {
      en: 'For an online model, yes. Add a key from OpenRouter, OpenAI, Anthropic or another supported provider in Settings → Providers. The key stays on your device and the provider bills the calls. A local Ollama model needs no key.',
      ar: 'للنموذج المتصل بالإنترنت، نعم. أضف مفتاحاً من OpenRouter أو OpenAI أو Anthropic أو مزوّد مدعوم آخر من الإعدادات ← المزوّدون. يبقى المفتاح على جهازك والمزوّد يحصّل تكلفة الاستدعاءات. ونموذج Ollama المحلي لا يحتاج مفتاحاً.',
    },
  },
  {
    q: { en: 'Do I need an account?', ar: 'هل أحتاج حساباً؟' },
    a: {
      en: 'No. Open a folder and start a task without signing in. Sign in only when you want to sync settings across devices.',
      ar: 'لا. افتح مجلداً وابدأ مهمة دون تسجيل الدخول. سجّل الدخول فقط عندما تريد مزامنة الإعدادات بين أجهزتك.',
    },
  },
  {
    q: { en: 'Are macOS and Linux packaged?', ar: 'هل تتوفر حزم لماك ولينكس؟' },
    a: {
      en: 'No. SADEEM is packaged for Windows 10/11 x64 only, as an installer and a portable ZIP.',
      ar: 'لا. يُوفَّر سديم لويندوز 10/11 x64 فقط، كمثبّت وملف مضغوط محمول.',
    },
  },
  {
    q: { en: 'Can I undo a change the agent made?', ar: 'هل يمكنني التراجع عن تغيير أجراه الوكيل؟' },
    a: {
      en: 'Yes. Before an allowed write the app takes a git shadow-commit on a dedicated ref, leaving your index and stash untouched. /undo restores the files and the conversation together; outside a git repo it falls back to file copies.',
      ar: 'نعم. قبل الكتابة المسموح بها يأخذ التطبيق نسخة shadow-commit على مرجع مخصص، دون لمس الفهرس أو الـstash. ويُرجع /undo الملفات والمحادثة معاً؛ وخارج مستودع git يستخدم نسخاً من الملفات.',
    },
  },
  {
    q: { en: 'How do I check what actually ran?', ar: 'كيف أتحقق مما نفّذ فعلاً؟' },
    a: {
      en: 'A real change produces a signed proof package. sadeem verify <proof.json> --rerun checks the signature with no key, re-checks file fingerprints and re-runs the recorded test command. A valid signature proves the record is authentic, not that the code is correct; the harness checks evidence, it does not guarantee the model’s judgement.',
      ar: 'كل تغيير حقيقي يُنتج حزمة إثبات موقّعة. يتحقق sadeem verify <proof.json> --rerun من التوقيع بلا مفتاح، ويعيد فحص بصمات الملفات وتشغيل أمر الاختبار المسجّل. التوقيع الصحيح يثبت أصالة السجل لا صحة الكود؛ والمنصّة تفحص الأدلة ولا تضمن حكم النموذج.',
    },
  },
];

function Faq() {
  const { tx } = useLang();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="d-faq">
      {FAQS.map((item, i) => {
        const isOpen = open === i;
        const panelId = `d-faq-panel-${i}`;
        const buttonId = `d-faq-button-${i}`;
        return (
          <div className={'faq-item' + (isOpen ? ' is-open' : '')} key={buttonId}>
            <button
              type="button"
              id={buttonId}
              className="faq-q"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              <span className="italic">{tx(item.q.en, item.q.ar)}</span>
              <span className="d-faq-q-sign" aria-hidden="true">{isOpen ? '−' : '+'}</span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="answer"
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  className="faq-a"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  style={{ overflow: 'hidden' }}
                >
                  <p>{tx(item.a.en, item.a.ar)}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

export function DownloadPage() {
  const { tx } = useLang();
  const exeSha: string = SITE.download.exeSha256;
  const zipSha: string = SITE.download.zipSha256;

  return (
    <div className="d-page">
      {/* HERO */}
      <section className="wrap d-hero">
        <div className="d-hero-grid">
          <motion.div
            className="d-hero-copy"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
          >
            <span className="label">◆ {tx('DOWNLOAD', 'التحميل')}</span>
            <h1 className="display d-hero-title">
              {tx('Download SADEEM', 'نزّل سديم')}
            </h1>
            <p className="lead">
              {tx('SADEEM is a local-first AI coding agent for Windows 10/11 x64. It maps the call sites, edits files, runs commands and calls 145 tools through a key you supply. Take the installer or the portable ZIP; both are free during the public season.', 'سادم وكيل برمجة ذكي يعمل محلياً على ويندوز 10/11 x64. يرسم مواقع الاستدعاء، ويعدّل الملفات، ويشغّل الأوامر، ويستدعي ١٤٥ أداة بمفتاح تضيفه أنت. اختر المثبّت أو الملف المحمول؛ كلاهما مجاني خلال الموسم العام.')}
            </p>
            <div className="d-hero-meta">
              <span className="mono">v{SITE.version}</span>
              <span>{tx('WINDOWS 10/11 · x64', 'ويندوز 10/11 · x64')}</span>
              <span>{tx('FREE DURING THE PUBLIC SEASON', 'مجاني خلال الموسم العام')}</span>
            </div>
            <div className="row d-hero-actions">
              <a className="btn btn-solid" href="#windows">
                <ArrowDownToLine size={17} aria-hidden="true" />
                {tx('Go to downloads', 'اذهب إلى التحميل')}
              </a>
              <Link className="btn" href="/changelog">
                {tx('Release history', 'سجل الإصدارات')} <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </motion.div>
          <ArtifactPlate />
        </div>
      </section>

      {/* PLATFORM STRIP */}
      <section className="wrap section-tight" style={{ paddingTop: 0 }}>
        <div className="rule" />
        <div className="d-strip">
          {[
            {
              n: '01',
              name: 'Windows',
              state: { en: 'Windows 10/11 x64 · available now', ar: 'ويندوز 10/11 x64 · متاح الآن' },
              live: true,
            },
            {
              n: '02',
              name: 'macOS',
              state: { en: 'Not packaged in this release', ar: 'لا توجد حزمة في هذا الإصدار' },
              live: false,
            },
            {
              n: '03',
              name: 'Linux',
              state: { en: 'Not packaged in this release', ar: 'لا توجد حزمة في هذا الإصدار' },
              live: false,
            },
          ].map((p, i) => (
            <motion.div
              key={p.name}
              className={'d-plat' + (p.live ? ' is-live' : '')}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.06 }}
            >
              <span className="d-plat-glyph"><PlatformGlyph n={p.n} /></span>
              <span className="d-plat-no">{p.n} / {p.live ? tx('AVAILABLE', 'متاح') : tx('NOT PACKAGED', 'غير متوفر')}</span>
              <h3 className="d-plat-name">{p.name}</h3>
              <p className="d-plat-state">{tx(p.state.en, p.state.ar)}</p>
              {p.live ? (
                <a href="#windows" className="d-plat-foot">
                  {tx('See the files', 'اطّلع على الملفات')} <ArrowRight size={14} aria-hidden="true" />
                </a>
              ) : (
                <span className="d-plat-off">— {tx('no download', 'لا يوجد تحميل')}</span>
              )}
            </motion.div>
          ))}
        </div>
      </section>

      {/* WINDOWS ARTIFACTS */}
      <section className="wrap section" id="windows">
        <div className="sec-head">
          <div className="sec-index">01 / {tx('THE FILES', 'الملفات')}</div>
          <div className="sec-body">
            <span className="label">{tx('WINDOWS x64 · v' + SITE.version, 'ويندوز x64 · v' + SITE.version)}</span>
            <h2 className="h2" style={{ marginTop: 16 }}>
              {tx('Two files.', 'ملفان.')} <span className="italic">{tx('One app.', 'تطبيق واحد.')}</span>
            </h2>
            <p className="lead">
              {tx('The same app, packaged two ways. Choose the installer for a guided setup or the ZIP to run from a folder. Each file has a checksum you can verify.', 'التطبيق نفسه بحزمتين. اختر المثبّت لتثبيت موجّه، أو الملف المضغوط للتشغيل من مجلد. لكل ملف بصمة يمكنك التحقق منها.')}
            </p>
          </div>
        </div>

        <div className="d-rows">
          <DownloadRow
            n="01"
            title={{ en: 'Windows installer', ar: 'مثبّت ويندوز' }}
            kind={{ en: 'Installer · ~108 MB', ar: 'مثبّت · ≈ 108 ميجابايت' }}
            desc={{ en: 'Guided setup with Start menu and desktop shortcuts. Uninstall cleanly from Windows Settings.', ar: 'إعداد موجّه مع اختصارات في قائمة ابدأ وعلى سطح المكتب، وإزالة نظيفة من إعدادات ويندوز.' }}
            href={SITE.download.exe}
            sha={exeSha}
            cta={{ en: 'Download installer', ar: 'حمّل المثبّت' }}
            parts={['/dl/setup.part00', '/dl/setup.part01']}
            filename="SADEEM-Setup-11.12.0.exe"
            recommended
          />
          <DownloadRow
            n="02"
            title={{ en: 'Portable ZIP', ar: 'ملف مضغوط محمول' }}
            kind={{ en: 'Portable · ~144 MB', ar: 'محمول · ≈ 144 ميجابايت' }}
            desc={{ en: 'No installation: unzip and run SADEEM.exe. Settings and data stay inside the folder.', ar: 'بلا تثبيت: فكّ الضغط وشغّل SADEEM.exe. تبقى الإعدادات والبيانات داخل المجلد.' }}
            href={SITE.download.zip}
            sha={zipSha}
            cta={{ en: 'Download ZIP', ar: 'حمّل الملف المضغوط' }}
            parts={['/dl/win.part00', '/dl/win.part01', '/dl/win.part02']}
            filename="SADEEM-11.12.0-win.zip"
          />
        </div>

        <p className="small d-note-line">
          {tx('Open Verify checksum under a file to see its SHA-256 value.', 'افتح «تحقّق من البصمة» أسفل الملف لعرض قيمة SHA-256.')}
        </p>
      </section>

      {/* COMMAND LINE */}
      <section className="wrap section-tight" id="cli">
        <div className="sec-head">
          <div className="sec-index">02 / {tx('COMMAND LINE', 'سطر الأوامر')}</div>
          <div className="sec-body">
            <span className="label">{tx('SADEEM CLI', 'سطر أوامر سادم')}</span>
            <h2 className="h2" style={{ marginTop: 16 }}>
              {tx('The same agent', 'الوكيل نفسه')} <span className="italic">{tx('in a terminal.', 'في الطرفية.')}</span>
            </h2>
            <p className="lead">
              {tx('The CLI runs the same agent engine as the desktop app. It uses the provider key you supply.', 'يشغّل سطر الأوامر محرك الوكيل نفسه الذي يستخدمه تطبيق سطح المكتب، ويستخدم مفتاح المزوّد الذي تضيفه.')}
            </p>
            <div className="panel panel-pad" style={{ marginTop: 28 }}>
              <p className="mono" dir="ltr"><code>npm i -g sadeem-cli</code></p>
              <p className="mono" dir="ltr" style={{ marginTop: 14 }}><code>{'sadeem run "<task>"'}</code></p>
              <p className="small" style={{ marginTop: 14 }}>
                {tx('Run sadeem on its own to open an interactive session.', 'شغّل سادم وحده لفتح جلسة تفاعلية.')}
              </p>
            </div>
          </div>
        </div>
      </section>

      <hr className="rule" />

      {/* BEFORE YOU RUN */}
      <section className="wrap section">
        <div className="sec-head">
          <div className="sec-index">03 / {tx('BEFORE YOU RUN', 'قبل التشغيل')}</div>
          <div className="sec-body">
            <h2 className="h2">{tx('Three things to know.', 'ثلاث نقاط يجب معرفتها.')}</h2>
            <p className="lead">{tx('These points cover the installer, the key you supply and what the public season means.', 'تغطي هذه النقاط المثبّت والمفتاح الذي تضيفه ومعنى الموسم العام.')}</p>
          </div>
        </div>
        <div className="d-notes">
          {BEFORE.map((s, i) => (
            <motion.article
              className="d-note"
              key={s.n}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.06 }}
            >
              <span className="d-note-num">{s.n}</span>
              <h3 className="h3">{tx(s.title.en, s.title.ar)}</h3>
              <p>{tx(s.body.en, s.body.ar)}</p>
              <p className="d-note-path" dir="auto">
                {tx(s.path.en, s.path.ar)}
              </p>
            </motion.article>
          ))}
        </div>
      </section>

      {/* QUICK START */}
      <section className="wrap section-tight">
        <div className="sec-head">
          <div className="sec-index">04 / {tx('QUICK START', 'ابدأ بسرعة')}</div>
          <div className="sec-body">
            <h2 className="h2">{tx('From download', 'من التحميل')} <span className="italic">{tx('to first task.', 'إلى أول مهمة.')}</span></h2>
            <p className="lead">{tx('Four steps. Start free without an account.', 'أربع خطوات. ابدأ مجاناً بلا حساب.')}</p>
          </div>
        </div>
        <div className="d-quick">
          {QUICK.map((s, i) => (
            <motion.div
              className="d-step"
              key={s.n}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.05 }}
            >
              <span className="d-step-num">{s.n}</span>
              <h3 className="h3">{tx(s.title.en, s.title.ar)}</h3>
              <p>{tx(s.body.en, s.body.ar)}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* PRIVACY */}
      <section className="wrap section-tight">
        <motion.div
          className="panel panel-pad d-privacy"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55 }}
        >
          <span className="label">{tx('PRIVACY', 'الخصوصية')}</span>
          <div className="d-privacy-body">
            <h2 className="h3">{tx('Local-first.', 'محلي أولاً.')}</h2>
            <p>
              {tx('Workspace files and API keys stay on your device. Provider calls go directly to the provider you choose.', 'تبقى ملفات مساحة العمل ومفاتيح API على جهازك. تذهب استدعاءات النموذج مباشرة إلى المزوّد الذي تختاره.')}
            </p>
            <div className="d-privacy-tags">
              <span>#{tx('KEYS_ON_DEVICE', 'المفاتيح_على_الجهاز')}</span>
              <span>#{tx('LOCAL_EXECUTION', 'تنفيذ_محلي')}</span>
            </div>
          </div>
        </motion.div>
      </section>

      {/* FAQ */}
      <section className="wrap section" id="faq">
        <div className="sec-head">
          <div className="sec-index">05 / {tx('FAQ', 'الأسئلة الشائعة')}</div>
          <div className="sec-body">
            <h2 className="h2">{tx('Common questions', 'أسئلة شائعة')}</h2>
            <Faq />
            <p className="small d-faq-end">
              {tx('Want the full history? ', 'تريد الاطّلاع على السجل الكامل؟ ')}
              <Link className="d-inline" href="/changelog">
                {tx('See the changelog', 'اطّلع على سجل التحديثات')} <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
