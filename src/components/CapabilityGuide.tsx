// SADEEM — CapabilityGuide (STABLE, version-free).
// A self-contained, editorially-designed in-app field guide that explains what
// SADEEM can REALLY do: the 145-tool registry, tool profiles, the Living
// Playbook, MCP/subagents, and every real slash command grouped by purpose —
// plus an honest "recommended setup" (bring a key, try /model, try /profile).
//
// DESIGN / ACCESSIBILITY
//   · Editorial "ink on paper" voice: 1px strokes, hairlines, square corners,
//     serif display (--font-display-serif) for Latin, Cairo for RTL.
//   · Colors are existing CSS vars / color-mix() of vars — no new palette.
//   · Keyboard: role="dialog" + aria-modal, a real Close <button>, Esc to
//     dismiss, a focusable scroll region, and visible :focus-visible rings.
//   · Every continuous effect is guarded by prefers-reduced-motion AND
//     html.reduce-motion, with a static end state.
//
// BILINGUAL (the established t()/tx() pattern):
//   · t()  = makeT(lang) — the shared dictionary (app name, Close, ...).
//   · tx() = local (en, ar) picker — guide-only copy, since this component
//     owns no i18n.ts dictionary keys.
//   · `lang` is a prop (default 'en') so the whole guide is SSR-safe and
//     deterministic. The parent should pass settings.language.
//
// WIRING (the real, existing path — nothing faked):
//   The parent mounts <CapabilityGuide lang={settings.language} /> ONCE near the
//   other overlays. It listens for the `OPEN_GUIDE_EVENT` CustomEvent. The
//   command palette's "Open capability guide" command dispatches exactly that
//   event — the same pattern as SearchPanel's OPEN_SEARCH_EVENT. No store
//   field or new IPC channel is needed. A parent that prefers full control can
//   instead pass `open` + `onClose` (controlled mode).

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { makeT, type Lang } from '../i18n';
import { BookOpen, Check, Command, KeyRound, SlidersHorizontal, Sparkles, X, type LucideIcon } from 'lucide-react';
import './capability-guide.css';

/** The command palette dispatches this; the mounted guide listens for it. */
export const OPEN_GUIDE_EVENT = 'surnia:open-capability-guide';

export interface CapabilityGuideProps {
  /** Controlled open state. Omit for self-contained, event-driven mounting. */
  open?: boolean;
  /** Called when the user dismisses the guide (controlled mode). */
  onClose?: () => void;
  /** Interface language. Defaults to 'en'; pass settings.language from parent. */
  lang?: Lang;
}

type Bi = { en: string; ar: string };
type SlashRow = { cmd: string; desc: Bi };
type SlashGroup = { title: Bi; rows: SlashRow[] };

/** Every REAL slash command, grouped by purpose (mirrors Composer's menu plus
 *  the store-dispatched /status and /share). /plans is intentionally absent:
 *  SADEEM is BYOK — there is no subscription or monthly plan. */
export const SLASH_GROUPS: SlashGroup[] = [
  {
    title: { en: 'Session & memory', ar: 'الجلسة والذاكرة' },
    rows: [
      { cmd: '/clear', desc: { en: 'Start a fresh agent session.', ar: 'ابدأ جلسة وكيل جديدة.' } },
      { cmd: '/compact', desc: { en: 'Summarize the transcript and free context space.', ar: 'لخّص المحادثة وحرّر مساحة السياق.' } },
      { cmd: '/rewind', desc: { en: 'Pick a checkpoint and restore the workspace.', ar: 'اختر نقطة استعادة وأعد مساحة العمل.' } },
      { cmd: '/undo', desc: { en: 'Restore the newest checkpoint in one step.', ar: 'استعد أحدث نقطة استعادة بخطوة واحدة.' } },
      { cmd: '/continue', desc: { en: 'Resume the last task from where it stopped.', ar: 'أكمل آخر مهمة من حيث توقفت.' } },
      { cmd: '/fork', desc: { en: 'Fork this session into a new one.', ar: 'انسخ هذه الجلسة في جلسة جديدة.' } },
      { cmd: '/export', desc: { en: 'Download the session as a formatted text file.', ar: 'نزّل الجلسة كملف نصي منسّق.' } },
      { cmd: '/goal', desc: { en: 'Set a goal the agent tracks across the run.', ar: 'حدّد هدفاً يتابعه الوكيل أثناء التشغيل.' } },
      { cmd: '/schedule', desc: { en: 'Create a scheduled agent job.', ar: 'أنشئ مهمة وكيل مجدولة.' } },
      { cmd: '/handoff', desc: { en: 'Write a handoff note to resume later.', ar: 'اكتب ملاحظة تسليم للعودة لاحقاً.' } },
      { cmd: '/init', desc: { en: 'Generate project memory for the agent.', ar: 'أنشئ ذاكرة المشروع للوكيل.' } },
      { cmd: '/context', desc: { en: 'Show a breakdown of the context window.', ar: 'اعرض تفصيل نافذة السياق.' } },
      { cmd: '/cost', desc: { en: "Show this session's token and cost totals.", ar: 'اعرض إجمالي الرموز والتكلفة لهذه الجلسة.' } },
      { cmd: '/dna', desc: { en: 'Show what SADEEM learned in this workspace.', ar: 'اعرض ما تعلّمه سديم في مساحة العمل.' } },
    ],
  },
  {
    title: { en: 'Build & review', ar: 'البناء والمراجعة' },
    rows: [
      { cmd: '/plan', desc: { en: 'Read-only research, then propose a plan.', ar: 'بحث بالقراءة فقط ثم اقتراح خطة.' } },
      { cmd: '/review', desc: { en: 'Structured review of pending changes.', ar: 'مراجعة منظمة للتغييرات المعلّقة.' } },
      { cmd: '/tests', desc: { en: 'Generate tests for a file.', ar: 'أنشئ اختبارات لملف.' } },
      { cmd: '/diff', desc: { en: 'Show a unified diff of uncommitted changes (optional path).', ar: 'اعرض فروقاً موحّدة للتغييرات غير المُودَعة (مسار اختياري).' } },
      { cmd: '/test', desc: { en: 'Run the test command with a real exit-code verdict.', ar: 'شغّل اختبارات المشروع مع نتيجة حقيقية برمز الخروج.' } },
      { cmd: '/explain', desc: { en: 'Read a file and explain it in your language.', ar: 'اقرأ ملفاً واشرحه بلغتك.' } },
      { cmd: '/commit', desc: { en: 'Suggest a commit message for the current diff.', ar: 'اقترح رسالة إيداع للتغييرات الحالية.' } },
      { cmd: '/pr', desc: { en: 'Draft a pull-request description from your changes.', ar: 'اكتب مسودة وصف طلب سحب من تغييراتك.' } },
      { cmd: '/grill', desc: { en: 'Interview me before coding — recommended options first.', ar: 'قابِلني بأسئلة قبل البرمجة — خيارات موصى بها أولاً.' } },
      { cmd: '/changelog', desc: { en: 'Write release notes from recent commits.', ar: 'اكتب ملاحظات الإصدار من الإيداعات الأخيرة.' } },
      { cmd: '/flows', desc: { en: 'Manage one-click flows.', ar: 'أدر التدفقات بنقرة واحدة.' } },
    ],
  },
  {
    title: { en: 'Agent & model', ar: 'الوكيل والنموذج' },
    rows: [
      { cmd: '/effort', desc: { en: 'Toggle deep-thinking effort.', ar: 'بدّل مستوى التفكير العميق.' } },
      { cmd: '/model', desc: { en: 'Switch the active AI model.', ar: 'بدّل نموذج الذكاء الاصطناعي النشط.' } },
      { cmd: '/profile', desc: { en: 'Switch the tool profile: essential, balanced or full.', ar: 'بدّل ملف الأدوات: أساسي أو متوازن أو كامل.' } },
      { cmd: '/mode', desc: { en: 'Cycle the permission mode.', ar: 'بدّل وضع الأذونات.' } },
      { cmd: '/budget', desc: { en: 'Show real token and cost totals for this session.', ar: 'اعرض إجمالي الرموز والتكلفة الحقيقي لهذه الجلسة.' } },
      { cmd: '/status', desc: { en: 'Print a compact session status report.', ar: 'اعرض تقريراً مختصراً عن حالة الجلسة.' } },
    ],
  },
  {
    title: { en: 'Panels & app', ar: 'اللوحات والتطبيق' },
    rows: [
      { cmd: '/settings', desc: { en: 'Open Settings.', ar: 'افتح الإعدادات.' } },
      { cmd: '/theme', desc: { en: 'Cycle the interface theme.', ar: 'بدّل سمة الواجهة.' } },
      { cmd: '/lang', desc: { en: 'Toggle the interface language (Arabic / English).', ar: 'بدّل لغة الواجهة (عربي / إنجليزي).' } },
      { cmd: '/terminal', desc: { en: 'Toggle the integrated terminal.', ar: 'أظهر الطرفية المدمجة أو أخفِها.' } },
      { cmd: '/help', desc: { en: 'List the available commands in chat.', ar: 'اعرض الأوامر المتاحة في المحادثة.' } },
      { cmd: '/git', desc: { en: 'Open source control.', ar: 'افتح التحكم بالمصدر.' } },
      { cmd: '/mcp', desc: { en: 'List MCP servers or test one by id.', ar: 'اعرض خوادم الأدوات الخارجية أو اختبر أحدها بمعرّفه.' } },
      { cmd: '/skills', desc: { en: 'Toggle skill injection or list workspace skills.', ar: 'فعّل المهارات أو أوقفها أو اعرض مهارات مساحة العمل.' } },
      { cmd: '/usage', desc: { en: 'Open the usage and cost panel.', ar: 'افتح لوحة الاستخدام والتكلفة.' } },
      { cmd: '/library', desc: { en: 'Open the output library.', ar: 'افتح مكتبة المخرجات.' } },
      { cmd: '/prompts', desc: { en: 'Open the reusable prompt library.', ar: 'افتح مكتبة التوجيهات القابلة لإعادة الاستخدام.' } },
      { cmd: '/share', desc: { en: 'Save a shareable HTML report of the session.', ar: 'احفظ تقريراً قابلاً للمشاركة عن الجلسة.' } },
    ],
  },
];

/** Tool-profile comparison — exact counts from the live registry. */
const TOOL_PROFILES: { id: Bi; count: string; note: Bi }[] = [
  {
    id: { en: 'essential', ar: 'أساسي' },
    count: '40',
    note: { en: 'Leanest prompt — best for small or weak models.', ar: 'أخف نافذة سياق — الأنسب للنماذج الصغيرة أو الضعيفة.' },
  },
  {
    id: { en: 'balanced', ar: 'متوازن' },
    count: '120',
    note: { en: 'The default — a practical middle ground.', ar: 'الافتراضي — حل وسط عملي.' },
  },
  {
    id: { en: 'full', ar: 'كامل' },
    count: '145',
    note: { en: 'Every registered tool, for capable models.', ar: 'كل الأدوات المسجّلة، للنماذج القادرة.' },
  },
];

const PLAYBOOK_SECTIONS: Bi[] = [
  { en: 'worked', ar: 'ما نجح' },
  { en: 'failed', ar: 'ما فشل' },
  { en: 'preferences', ar: 'التفضيلات' },
  { en: 'recipes', ar: 'الوصفات' },
];

const CAPABILITIES: { icon: typeof Command; title: Bi; body: Bi }[] = [
  {
    icon: Command,
    title: { en: '145 real tools', ar: '145 أداة حقيقية' },
    body: {
      en: 'Files, terminal, git, browser, documents, images, PDFs, SQLite and more — every call gated by your approval posture.',
      ar: 'ملفات وطرفية واعتماديات ومتصفح ومستندات وصور وملفات بي دي إف وقواعد بيانات وغيرها — كل استدعاء يخضع لإعدادات الموافقة لديك.',
    },
  },
  {
    icon: SlidersHorizontal,
    title: { en: 'Tool profiles', ar: 'ملفات الأدوات' },
    body: {
      en: 'Choose how many tools the model sees: essential (40), balanced (120) or full (145).',
      ar: 'اختر عدد الأدوات التي يراها النموذج: أساسي (40) أو متوازن (120) أو كامل (145).',
    },
  },
  {
    icon: Sparkles,
    title: { en: 'Living Playbook', ar: 'الدليل الحيّ' },
    body: {
      en: 'Each run can distill what worked, what failed and your preferences into a versioned, per-workspace playbook.',
      ar: 'يمكن لكل تشغيل أن يلخّص ما نجح وما فشل وتفضيلاتك في دليل مُنسَّخ لكل مساحة عمل.',
    },
  },
  {
    icon: BookOpen,
    title: { en: 'MCP & subagents', ar: 'وكلاء خارجيون وفروع' },
    body: {
      en: 'Connect real MCP servers to extend the toolset, and delegate focused work to background subagents.',
      ar: 'اربط خوادم خارجية حقيقية لتوسيع الأدوات، وكلّف وكلاء فرعيين بأعمال مركّزة في الخلفية.',
    },
  },
];

/** Resolve a bilingual value for the active language. */
function pick(lang: Lang, text: Bi): string {
  return lang === 'ar' ? text.ar : text.en;
}

export function CapabilityGuide({ open, onClose, lang = 'en' }: CapabilityGuideProps) {
  const t = useMemo(() => makeT(lang), [lang]);
  const tx = useCallback((en: string, ar: string) => (lang === 'ar' ? ar : en), [lang]);

  // Uncontrolled state powers the self-contained, event-driven mounting.
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;

  const reactId = useId();
  const baseId = `capguide-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const titleId = `${baseId}-title`;
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setInternalOpen(false);
    onClose?.();
  }, [onClose]);

  // Listen for the palette's dispatch — mounted once, opens regardless of
  // whether the component is currently rendered (the component itself returns
  // null while closed, but this effect stays alive).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOpen = () => setInternalOpen(true);
    window.addEventListener(OPEN_GUIDE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_GUIDE_EVENT, onOpen);
  }, []);

  // Esc dismisses — capture phase so it wins over any other bubble handler.
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, close]);

  // Move focus into the dialog on open (browser only, SSR-safe via rAF).
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const id = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="cg-scrim"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className="cg-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        lang={lang}
      >
        <header className="cg-masthead">
          <span className="cg-eyebrow" aria-hidden>
            {tx('FIELD GUIDE', 'دليل الميدان')}
          </span>
          <span className="cg-rule" aria-hidden />
          <button
            ref={closeRef}
            type="button"
            className="cg-close"
            onClick={close}
            aria-label={t('common.close', tx('Close capability guide', 'إغلاق دليل الإمكانيات'))}
            title={t('common.close', tx('Close', 'إغلاق'))}
          >
            <X size={16} strokeWidth={1.6} aria-hidden />
          </button>
        </header>

        <div className="cg-scroll" tabIndex={0} role="document">
          {/* ── Title plate ── */}
          <div className="cg-titleplate">
            <div className="cg-kicker">
              <BookOpen size={14} strokeWidth={1.6} aria-hidden />
              <span>{tx('WHAT SADEEM CAN DO', 'ما الذي يستطيع سديم فعله')}</span>
            </div>
            <h1 id={titleId} className="cg-title">
              {tx('The capability guide', 'دليل الإمكانيات')}
            </h1>
            <p className="cg-lede">
              {tx(
                '145 registered tools, tool profiles, a Living Playbook and every real slash command — in one honest page.',
                '145 أداة مسجّلة، وملفات أدوات، ودليل حيّ، وكل أمر حقيقي من أوامر الشرطة المائلة — في صفحة واحدة صادقة.',
              )}
            </p>
            <p className="cg-stamp">
              <Check size={12} strokeWidth={2} aria-hidden />
              {tx('BYOK — bring your own key. No subscription, no monthly plan.', 'بمفتاحك الخاص — لا اشتراك ولا خطة شهرية.')}
            </p>
          </div>

          {/* ── Real capabilities ── */}
          <section className="cg-section" aria-label={tx('Real capabilities', 'إمكانيات حقيقية')}>
            <h2 className="cg-h">
              <span className="cg-num" aria-hidden>01</span>
              {tx('Real capabilities', 'إمكانيات حقيقية')}
            </h2>
            <div className="cg-cap-grid">
              {CAPABILITIES.map((c, i) => {
                const Icon = c.icon;
                return (
                  <article className="cg-cap" key={i}>
                    <Icon size={17} strokeWidth={1.5} aria-hidden />
                    <h3 className="cg-cap-title">{pick(lang, c.title)}</h3>
                    <p className="cg-cap-body">{pick(lang, c.body)}</p>
                  </article>
                );
              })}
            </div>
          </section>

          {/* ── Slash commands ── */}
          <section className="cg-section" aria-label={tx('Slash commands', 'أوامر الشرطة المائلة')}>
            <h2 className="cg-h">
              <span className="cg-num" aria-hidden>02</span>
              {tx('Slash commands by purpose', 'أوامر الشرطة المائلة حسب الغرض')}
            </h2>
            <p className="cg-section-note">
              {tx(
                'Type these in the chat. Each one does a real, verifiable thing — no decoration.',
                'اكتبها في المحادثة. كل واحد منها يقوم بعمل حقيقي قابل للتحقق — بلا زخرفة.',
              )}
            </p>
            <div className="cg-groups">
              {SLASH_GROUPS.map((g, gi) => (
                <div className="cg-group" key={gi}>
                  <h3 className="cg-group-title">{pick(lang, g.title)}</h3>
                  <dl className="cg-cmds">
                    {g.rows.map((r) => (
                      <div className="cg-cmd" key={r.cmd}>
                        <dt className="cg-cmd-name"><code>{r.cmd}</code></dt>
                        <dd className="cg-cmd-desc">{pick(lang, r.desc)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>

          {/* ── Tool profiles ── */}
          <section className="cg-section" aria-label={tx('Tool profiles', 'ملفات الأدوات')}>
            <h2 className="cg-h">
              <span className="cg-num" aria-hidden>03</span>
              {tx('Tool profiles — why fewer tools helps', 'ملفات الأدوات — لماذا الأدوات الأقل أفضل')}
            </h2>
            <p className="cg-section-note">
              {tx(
                'Every tool is a JSON schema sent on every request. At the full profile that is about 87 KB — roughly half the prompt. A small or weak model can spend its attention choosing among 145 tools instead of doing the work. A leaner profile sends fewer schemas, so it answers faster and makes fewer mistakes.',
                'كل أداة هي مخطط بيانات يُرسل في كل طلب. عند الملف الكامل يبلغ ذلك نحو 87 كيلوبايت — نحو نصف الرسالة. قد يستهلك النموذج الصغير أو الضعيف انتباهه في الاختيار بين 145 أداة بدل إنجاز العمل. الملف الأخف يرسل مخططات أقل، فيجيب أسرع ويخطئ أقل.',
              )}
            </p>
            <div className="cg-profiles">
              {TOOL_PROFILES.map((p, i) => (
                <div className="cg-profile" key={i}>
                  <div className="cg-profile-top">
                    <span className="cg-profile-name">{pick(lang, p.id)}</span>
                    <span className="cg-profile-count tnum">{p.count}</span>
                  </div>
                  <p className="cg-profile-note">{pick(lang, p.note)}</p>
                </div>
              ))}
            </div>
            <p className="cg-inline-tip">
              <span className="cg-cmd-name"><code>/profile</code></span>
              {tx(' switches profiles instantly — no restart.', ' يبدّل الملف فوراً — بلا إعادة تشغيل.')}
            </p>
          </section>

          {/* ── Living Playbook ── */}
          <section className="cg-section" aria-label={tx('Living Playbook', 'الدليل الحيّ')}>
            <h2 className="cg-h">
              <span className="cg-num" aria-hidden>04</span>
              {tx('Living Playbook', 'الدليل الحيّ')}
            </h2>
            <p className="cg-section-note">
              {tx(
                'After a run, SADEEM can distill lessons into a versioned, per-workspace playbook. Those notes are fed back as advisory context on later runs — so it gets better on your project over time. Advisory only: your current request always wins.',
                'بعد كل تشغيل، يمكن لسديم تلخيص الدروس في دليل مُنسَّخ خاص بمساحة العمل. تُعاد هذه الملاحظات كسياق إرشادي في التشغيلات اللاحقة — فيتحسّن أداؤه على مشروعك بمرور الوقت. إرشادي فقط: طلبك الحالي هو الذي يُعمل به دائماً.',
              )}
            </p>
            <ul className="cg-playbook">
              {PLAYBOOK_SECTIONS.map((s, i) => (
                <li className="cg-pill" key={i}>{pick(lang, s)}</li>
              ))}
            </ul>
          </section>

          {/* ── Recommended setup ── */}
          <section className="cg-section" aria-label={tx('Recommended setup', 'الإعداد الموصى به')}>
            <h2 className="cg-h">
              <span className="cg-num" aria-hidden>05</span>
              {tx('Recommended setup', 'الإعداد الموصى به')}
            </h2>
            <ol className="cg-steps">
              <li className="cg-step">
                <span className="cg-step-icon"><KeyRound size={14} strokeWidth={1.7} aria-hidden /></span>
                <span>
                  <strong>{tx('Bring a key.', 'أدخل مفتاحك.')}</strong>{' '}
                  {tx(
                    'Add your provider API key in Settings → AI providers. It stays on this device; SADEEM is bring-your-own-key, with no subscription.',
                    'أضف مفتاح مزوّدك من الإعدادات ← مزودو الذكاء الاصطناعي. يبقى على جهازك؛ سديم يعمل بمفتاحك الخاص بلا اشتراك.',
                  )}
                </span>
              </li>
              <li className="cg-step">
                <span className="cg-step-icon"><Sparkles size={14} strokeWidth={1.7} aria-hidden /></span>
                <span>
                  <code className="cg-step-cmd">/model</code>{' '}
                  {tx('Try a different model — pick one that fits your task and budget.', 'جرّب نموذجاً آخر — اختر ما يناسب مهمتك وميزانيتك.')}
                </span>
              </li>
              <li className="cg-step">
                <span className="cg-step-icon"><SlidersHorizontal size={14} strokeWidth={1.7} aria-hidden /></span>
                <span>
                  <code className="cg-step-cmd">/profile</code>{' '}
                  {tx('If replies feel slow or confused, switch to essential or balanced.', 'إذا بدت الإجابات بطيئة أو مشتتة، بدّل إلى الأساسي أو المتوازن.')}
                </span>
              </li>
            </ol>
          </section>
        </div>

        <footer className="cg-footer">
          <span className="cg-footer-note">
            {t('app.name', 'SADEEM')} · {tx('Escape closes this guide', 'زر الإفلات يغلق هذا الدليل')}
          </span>
          <button type="button" className="cg-primary" onClick={close}>
            {tx('Got it', 'فهمت')}
          </button>
        </footer>
      </section>
    </div>
  );
}

export default CapabilityGuide;
