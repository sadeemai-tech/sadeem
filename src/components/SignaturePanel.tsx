// SignaturePanel — rail 16 · the two genuinely unique SADEEM instruments.
// ============================================================
// This panel is a RENDERER OF REAL DATA, not a brochure. Every row below is
// computed by electron/agent/signatureFeatures.ts from stores this app
// already persists: session messages (real tool args + real output), the
// JSONL run journal via api.journalList/journalRead, and the real 145-tool
// CORE_DEFS inventory.
//
// v11.42 — DNA Insights (the former "autopsy" tab) MOVED into DnaPanel.tsx
// as a read-only collapsible section beside the patterns it explains. The
// pure engine (autopsyDNA / promptVisibleIds) stays in signatureFeatures.ts.
//
// No new IPC, no new i18n keys, no fabricated numbers. Empty stores say so.
// Hairline grammar only: 1px rules, tabular numerals, 2px confidence lines —
// no boxy cards, no gradients, no shadows. EN/AR from the store language.
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { JournalEvent, JournalSummary } from '../lib/api';
import { useStore } from '../store';
import { PageHead } from './pages';
import {
  buildTrajectory,
  compass,
  type LedgerEvent,
  type LedgerMessage,
  type TrajectoryStep,
} from '../../electron/agent/signatureFeatures';
import './pages.css';
import './signature-art.css';

// v11.42 — REPLAY + COMPASS only. The third view lives on the DNA rail now.
type Tab = 'trajectory' | 'compass';

/** The store types sessions as metadata; the persisted session JSON carries
 *  the real `messages` array we replay. This is the honest structural view. */
interface LedgerSession {
  id: string;
  title?: string;
  messages?: readonly LedgerMessage[];
}

function shortTime(ts: number | undefined, ar: boolean): string {
  if (!ts || !Number.isFinite(ts)) return ar ? '—' : '—';
  const d = Date.now() - ts;
  const m = Math.floor(d / 60_000);
  const h = Math.floor(d / 3_600_000);
  const dd = Math.floor(d / 86_400_000);
  if (m < 1) return ar ? 'الآن' : 'now';
  if (h < 1) return ar ? `قبل ${m}د` : `${m}m`;
  if (dd < 1) return ar ? `قبل ${h}س` : `${h}h`;
  if (dd < 7) return ar ? `قبل ${dd}ي` : `${dd}d`;
  return new Date(ts).toLocaleDateString(ar ? 'ar' : 'en');
}

/** A ruled, borderless step row — the replay is a thread, not a table. */
function ReplayStepRow({ step, ar }: { step: TrajectoryStep; ar: boolean }) {
  const kindLabel =
    step.kind === 'tool_call' ? (ar ? 'استدعاء' : 'call')
      : step.kind === 'tool_result' ? (ar ? 'نتيجة' : 'result')
      : step.kind === 'milestone' ? (ar ? 'حدث' : 'event')
      : step.kind === 'user' ? (ar ? 'أنت' : 'you')
      : (ar ? 'سديم' : 'sadeem');
  return (
    <li className={`sg-step sg-step--${step.kind}`}>
      <span className="sg-step-no tnum" aria-hidden>{String(step.index).padStart(2, '0')}</span>
      <div className="sg-step-main min-w-0">
        <div className="sg-step-head">
          <span className="sg-step-kind">{kindLabel}</span>
          <span className="sg-step-label" dir="auto" title={step.label}>{step.label}</span>
          {step.durationMs !== undefined && (
            <span className="sg-step-metric tnum" dir="ltr" title={ar ? 'مدة التنفيذ الفعلية' : 'real journal duration'}>
              {step.durationMs}ms
            </span>
          )}
          {step.traceChars !== undefined && (
            <span className="sg-step-metric tnum" dir="ltr" title={ar ? 'حجم النتيجة من التتبّع' : 'real trace output size'}>
              {step.traceChars}c
            </span>
          )}
          {step.ok === false && <span className="sg-step-bad">{ar ? 'فشل' : 'failed'}</span>}
          {step.unpairedResult && (
            <span className="sg-step-warn" title={ar ? 'لا يوجد استدعاء مطابق في هذه الجلسة' : 'no matching call in this session'}>
              {ar ? 'بلا استدعاء' : 'unpaired'}
            </span>
          )}
          <span className="sg-step-src" dir="ltr">{step.sources.join('+')}</span>
        </div>
        {step.input && (
          <div className="sg-step-io">
            <span className="sg-step-k">{ar ? 'إدخال' : 'input'}{step.inputClipped ? '…' : ''}</span>
            <code dir="auto" className="sg-step-code">{step.input}</code>
          </div>
        )}
        {step.output && (
          <div className="sg-step-io">
            <span className="sg-step-k">{ar ? 'إخراج' : 'output'}{step.outputClipped ? '…' : ''}</span>
            <code dir="auto" className="sg-step-code">{step.output}</code>
          </div>
        )}
        <div className="sg-step-foot">
          {step.at !== undefined && <span className="tnum" dir="ltr">{shortTime(step.at, ar)}</span>}
          {step.pairedWith !== undefined && (
            <span className="tnum" dir="ltr">{ar ? `مرتبط بـ ${String(step.pairedWith).padStart(2, '0')}` : `↳ ${String(step.pairedWith).padStart(2, '0')}`}</span>
          )}
        </div>
      </div>
    </li>
  );
}

/** Optional seams for deep links and SSR tests; the rail renders with defaults. */
export interface SignaturePanelProps {
  initialTab?: Tab;
  initialIntent?: string;
}

export function SignaturePanel({ initialTab = 'trajectory', initialIntent = '' }: SignaturePanelProps) {
  const lang = useStore((s) => s.settings.language);
  const ar = lang === 'ar';
  const L = (en: string, arText: string): string => (ar ? arText : en);
  const sessions = useStore((s) => s.sessions) as unknown as readonly LedgerSession[];
  const activeSessionId = useStore((s) => s.session?.id ?? '');

  const [tab, setTab] = useState<Tab>(initialTab);
  const [sessionId, setSessionId] = useState('');
  const [journals, setJournals] = useState<JournalSummary[]>([]);
  const [events, setEvents] = useState<JournalEvent[]>([]);
  const [intent, setIntent] = useState(initialIntent);

  const chosenId = sessionId || activeSessionId || sessions[0]?.id || '';
  const session = useMemo(() => sessions.find((s) => s.id === chosenId), [sessions, chosenId]);

  // REAL journal lines, loaded through the existing allowlisted bridge.
  useEffect(() => {
    let alive = true;
    setEvents([]);
    if (typeof api.journalList !== 'function') return () => { alive = false; };
    void api
      .journalList(8)
      .then(async (list) => {
        if (!alive) return;
        setJournals(list);
        const match = list.find((j) => j.sessionId === chosenId) ?? list[0];
        if (match && typeof api.journalRead === 'function') {
          const rows = await api.journalRead(match.file, 200);
          if (alive) setEvents(rows as JournalEvent[]);
        }
      })
      .catch(() => {
        // No journal on disk is an honest empty state — never fabricate one.
      });
    return () => { alive = false; };
  }, [chosenId]);

  const journalLedgerEvents = useMemo(
    () => events.map((e) => e as unknown as LedgerEvent),
    [events],
  );

  const traj = useMemo(
    () => buildTrajectory({
      sessionId: session?.id ?? '',
      title: session?.title ?? '',
      messages: (session?.messages ?? []) as unknown as LedgerMessage[],
      journalEvents: journalLedgerEvents,
    }),
    [session, journalLedgerEvents],
  );

  // REAL call counts from the replay + the journal: "use all tools" needs a
  // truthful denominator before it can name an unused tool.
  const calledNames = useMemo(() => {
    const out: string[] = [];
    for (const s of traj.steps) {
      if ((s.kind === 'tool_call' || s.kind === 'tool_result') && s.label && s.label !== 'tool') out.push(s.label);
    }
    for (const e of journalLedgerEvents) {
      if (e.type === 'tool' && typeof e.name === 'string') out.push(e.name);
    }
    return out;
  }, [traj, journalLedgerEvents]);

  const route = useMemo(() => compass({ intent, calledToolNames: calledNames }), [intent, calledNames]);

  const tabs: Array<{ id: Tab; en: string; ar: string }> = [
    { id: 'trajectory', en: 'REPLAY', ar: 'إعادة العرض' },
    { id: 'compass', en: 'COMPASS', ar: 'بوصلة الأدوات' },
  ];

  return (
    <div className="sg-panel page-v14" dir={ar ? 'rtl' : 'ltr'}>
      <PageHead
        eyebrow={ar ? '١٦ / بصمة سديم' : '16 / SIGNATURE'}
        title={ar ? 'أدوات لا يملكها غيرنا' : 'Built only here'}
        description={ar
          ? 'مقياسان يقرآن سجلات التشغيل ومخزون أدواتك الحقيقي — بلا أرقام مُختلقة. رؤى الحمض انتقلت إلى صفحة الحمض النووي.'
          : 'Two instruments reading your real run ledgers and 145-tool inventory — no invented numbers. DNA Insights moved to the DNA page.'}
        toolbar={
          <svg className="sg-glyph" viewBox="0 0 64 18" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
            <path d="M1 9h12m4 0h8m4 0h6m4 0h10m4 0h10" />
            <circle cx="15" cy="9" r="2" /><circle cx="33" cy="9" r="2" /><circle cx="51" cy="9" r="2" />
          </svg>
        }
      />

      {/* hairline tab strip */}
      <div className="sg-tabs" role="tablist" aria-label={L('Signature instruments', 'أدوات سديم')}>
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            className={'sg-tab' + (tab === x.id ? ' is-on' : '')}
            onClick={() => setTab(x.id)}
          >
            {ar ? x.ar : x.en}
          </button>
        ))}
      </div>

      {/* ---------- 1 · TRAJECTORY ---------- */}
      {tab === 'trajectory' && (
        <section className="sg-section" role="tabpanel" aria-label={L('Trajectory replay', 'إعادة العرض')}>
          <div className="sg-toolbar">
            <label className="sg-field">
              <span>{L('Run', 'التشغيل')}</span>
              <select
                value={chosenId}
                onChange={(e) => setSessionId(e.target.value)}
                aria-label={L('Choose a recorded run', 'اختر تشغيلاً مسجّلاً')}
              >
                {sessions.length === 0 && <option value="">{L('no recorded sessions', 'لا توجد جلسات')}</option>}
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>{s.title || s.id}</option>
                ))}
              </select>
            </label>
            <span className="sg-toolbar-stat tnum" dir="ltr">
              {traj.stats.toolCalls} {L('calls', 'استدعاء')} · {traj.stats.stepsShown}/{traj.stats.stepsTotal}
              {traj.truncated ? ' ' + L('(capped)', '(محدود)') : ''}
            </span>
            {journals.length > 0 && (
              <span className="sg-toolbar-stat" dir="auto">
                {L('journal matched', 'سجل مطابق')}: {journals.length}
              </span>
            )}
          </div>

          {traj.steps.length === 0 ? (
            <p className="sg-empty">
              {L('Nothing to replay yet. Runs appear here the moment a session or journal is recorded.',
                'لا شيء لإعادة عرضه بعد. تظهر التشغيلات هنا بمجرد تسجيل جلسة أو سجل تشغيل.')}
              <span className="sg-code" dir="ltr">{traj.emptyReason}</span>
            </p>
          ) : (
            <ol className="sg-thread">
              {traj.steps.map((s) => <ReplayStepRow key={`${s.index}-${s.label}`} step={s} ar={ar} />)}
            </ol>
          )}
          <p className="sg-caveat">
            {L('Input/output come from session messages; durations from the journal; sizes from the trace. A missing value stays blank.',
              'الإدخال والإخراج من رسائل الجلسة، والمدد من السجل، والأحجام من التتبّع. أي قيمة مفقودة تبقى فارغة.')}
          </p>
        </section>
      )}

      {/* ---------- 2 · CAPABILITY COMPASS ---------- */}
      {tab === 'compass' && (
        <section className="sg-section" role="tabpanel" aria-label={L('Capability compass', 'بوصلة الأدوات')}>
          <label className="sg-intent">
            <span>{L('What do you want to do?', 'ماذا تريد أن تفعل؟')}</span>
            <input
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder={ar ? 'مثال: ابحث عن نص داخل ملفات المشروع' : 'e.g. find text inside project files'}
              aria-label={L('Describe an intent', 'صف مهمة')}
              dir="auto"
              spellCheck={false}
            />
          </label>

          <div className="sg-coverage">
            <span className="sg-coverage-label" dir="auto">
              {L('Inventory used', 'المخزون المستخدم')}
            </span>
            <span className="sg-coverage-track" aria-hidden>
              <span className="sg-coverage-fill" style={{ width: `${route.coverage.percent}%` }} />
            </span>
            <span className="sg-coverage-num tnum" dir="ltr">
              {route.coverage.called}/{route.coverage.inventory} · {route.coverage.percent}%
            </span>
            {route.coverage.unknownCalled > 0 && (
              <span className="sg-coverage-unknown" dir="auto">
                {L('outside inventory', 'خارج المخزون')}: {route.coverage.unknownCalled}
              </span>
            )}
          </div>

          {!intent.trim() ? (
            <p className="sg-empty">
              {L('Describe an intent — suggestions come from the real tool inventory and your real call history.',
                'صف مهمة — تظهر الاقتراحات من مخزون الأدوات الحقيقي وسجل استدعاءاتك الفعلي.')}
              <span className="sg-code" dir="ltr">{route.emptyReason}</span>
            </p>
          ) : route.top.length === 0 ? (
            <p className="sg-empty">
              {L('No real tool matched those words. Try the operation itself, e.g. "read", "search", "diff".',
                'لم يطابق أي أداة حقيقية هذه الكلمات. جرّب الفعل نفسه مثل «اقرأ» أو «ابحث» أو «قارن».')}
            </p>
          ) : (
            <ol className="sg-recs">
              {route.top.map((r) => (
                <li className="sg-rec" key={r.name}>
                  <div className="sg-rec-head">
                    <code className="sg-rec-name" dir="ltr">{r.name}</code>
                    <span className="sg-rec-profile" dir="ltr">{r.profile ?? r.kind ?? 'tool'}</span>
                    <span className="sg-rec-score tnum" dir="ltr">{r.score}</span>
                    {r.callCount > 0 && <span className="sg-rec-used tnum" dir="ltr">×{r.callCount}</span>}
                  </div>
                  <div className="sg-rec-hint" dir="auto">{r.hint}</div>
                  <div className="sg-rec-reasons">
                    {r.reasons.map((reason, i) => (
                      <span key={`${reason.type}-${i}`} className={'sg-rec-reason sg-rec-reason--' + reason.type} title={reason.detail}>
                        <span className="sg-rec-reason-type" dir="ltr">{reason.type}</span>
                        <span className="sg-rec-reason-detail" dir="auto">{reason.detail}</span>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {route.undiscovered.length > 0 && (
            <div className="sg-undiscovered">
              <div className="sg-subhead">{L('UNUSED CAPABILITIES', 'قدرات لم تُستخدم')}</div>
              <ul>
                {route.undiscovered.map((u) => (
                  <li key={u.name}>
                    <code dir="ltr">{u.name}</code>
                    <span dir="auto">{u.hint}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="sg-caveat">
            {L('Routing hints are mined from the descriptions the model already receives; call counts come from this ledger.',
              'تُستخرج تلميحات التوجيه من الأوصاف التي يتلقاها النموذج أصلاً، وأرقام الاستدعاء من هذا السجل.')}
          </p>
        </section>
      )}
    </div>
  );
}

export default SignaturePanel;
