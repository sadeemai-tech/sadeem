// DnaPanel — Rail view 06 · the SADEEM DNA map (SURVEYOR v5 grammar).
// Top-down by intent: growth strip (stat tiles) → agent-suggestion chip
// (violet --agent identity mark, dismissed via the store's clearDnaSuggestion)
// → 01 PROFILE (removable chips + inline add per section) → 02 LEARNED
// PATTERNS (keyrows with kind stamps + 2px confidence bars) → 03 DNA INSIGHTS
// (v11.42, collapsible + READ-ONLY: the former Signature "autopsy" tab,
// moved here so the explanation sits beside the facts it explains) →
// 04 FEEDBACK TIMELINE → privacy bar with the Forget actions. Live: the
// store's onDnaEvent subscription reloads dna; this panel only re-renders on
// dna/dnaStats change. All data stays local (dna.json) — the privacy bar
// says so, in both languages.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ShieldCheck, Trash2, X } from 'lucide-react';
import type { DNAFeedbackEntry, DNAPattern, PlaybookChange, PlaybookData, PlaybookRevision } from '../../../shared/types';
import {
  autopsyDNA,
  promptVisibleIds,
  type AutopsyFinding,
  type WhyCode,
} from '../../../electron/agent/signatureFeatures';
import { api } from '../../lib/api';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { Btn, SectionTitle, Spinner } from '../ui';
import { IcDna, IconTile } from '../icons';
import { PageHead } from '../pages';
import '../workspace.css';
import '../dna.css';
import '../pages.css';
import './dna-art.css';
import './panel-craft.css';
// v11.42 — reuse the exact hairline finding rows from the old Signature tab
// (no duplicated styles); scoped `.sg-*` classes cannot collide with DNA art.
import '../signature-art.css';
/** Profile array fields → the DNAProfile key + i18n label/ph keys. */
type ArrayField = 'expertise' | 'languages' | 'likes' | 'dislikes' | 'styleNotes';

const ARRAY_FIELDS: { field: ArrayField; labelKey: string; phKey: string }[] = [
  { field: 'expertise', labelKey: 'dna.expertise', phKey: 'dna.addExpertisePh' },
  { field: 'languages', labelKey: 'dna.languages', phKey: 'dna.addLangsPh' },
  { field: 'likes', labelKey: 'dna.likes', phKey: 'dna.addLikesPh' },
  { field: 'dislikes', labelKey: 'dna.dislikes', phKey: 'dna.addDislikesPh' },
  { field: 'styleNotes', labelKey: 'dna.styleNotes', phKey: 'dna.addStylePh' },
];

/** KIND stamp tone per pattern kind (existing .stamp tones). */
const KIND_STAMP: Record<DNAPattern['kind'], string> = {
  command: 'stamp-acc',
  workflow: 'stamp-clay',
  style: 'stamp-warn',
  correction: 'stamp-bad',
};

/** Feedback kind → stamp + label key. */
const FB_STAMP: Record<DNAFeedbackEntry['kind'], string> = {
  praise: 'stamp-acc',
  correction: 'stamp-bad',
  preference: 'stamp-clay',
};

/** Compact relative time (same grammar as WorkspacePanel.relTime). */
function relTime(ts: number, lang: string): string {
  if (!ts) return '';
  const d = Date.now() - ts;
  const m = Math.floor(d / 60_000);
  const h = Math.floor(d / 3_600_000);
  const dd = Math.floor(d / 86_400_000);
  if (lang === 'ar') {
    if (m < 1) return 'الآن';
    if (h < 1) return `قبل ${m}د`;
    if (dd < 1) return `قبل ${h}س`;
    if (dd < 7) return `قبل ${dd}ي`;
    return new Date(ts).toLocaleDateString('ar');
  }
  if (m < 1) return 'now';
  if (h < 1) return `${m}m ago`;
  if (dd < 1) return `${h}h ago`;
  if (dd < 7) return `${dd}d ago`;
  return new Date(ts).toLocaleDateString();
}

/* ============================================================
   v11.42 — DNA INSIGHTS (ported verbatim from SignaturePanel.tsx).
   READ-ONLY: every row is computed from the SAME `dna` store this
   panel already renders, by the pure autopsyDNA()/promptVisibleIds()
   in signatureFeatures.ts. No writes, no IPC, no fabricated numbers.
   Hairline `.sg-*` grammar comes from the shared signature-art.css.
   ============================================================ */

/** The reason chips stay literal (same bilingual labels as the old tab). */
const WHY_LABEL: Record<WhyCode, { en: string; ar: string }> = {
  STORED_REPETITION: { en: 'repeated', ar: 'تكرّر' },
  STORED_CONFIDENCE: { en: 'stored score', ar: 'درجة محفوظة' },
  EXPLICIT_FEEDBACK: { en: 'your feedback', ar: 'ملاحظتك' },
  PLAYBOOK_CHANGE: { en: 'playbook', ar: 'الدليل الحي' },
  JOURNAL_MEMORY: { en: 'run journal', ar: 'سجل التشغيل' },
  PROFILE_FIELD: { en: 'declared', ar: 'مُصرَّح به' },
  PROMPT_VISIBLE: { en: 'in next prompt', ar: 'في الموجّه التالي' },
  NOT_PROMPT_VISIBLE: { en: 'not in prompt', ar: 'خارج الموجّه' },
  LEGACY_CONFIDENCE: { en: 'edited score', ar: 'درجة معدَّلة' },
};

function insightTime(ts: number | undefined, ar: boolean): string {
  if (!ts || !Number.isFinite(ts)) return '—';
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

/** One learned fact: confidence line + the REAL evidence that produced it. */
function FindingRow({ f, ar }: { f: AutopsyFinding; ar: boolean }) {
  return (
    <li className="sg-finding">
      <div className="sg-finding-head">
        <span className="sg-finding-kind" dir="auto">{f.kind}</span>
        <span className="sg-finding-text" dir="auto" title={f.text}>{f.text}</span>
        {f.promptVisible && (
          <span className="sg-finding-live" title={ar ? 'يظهر في الموجّه التالي' : 'included in the next system prompt'}>
            {ar ? 'موجّه' : 'prompt'}
          </span>
        )}
      </div>
      <div className="sg-finding-meter">
        <span
          className="sg-finding-fill"
          style={{ width: `${Math.max(0, Math.min(100, Math.round((f.confidence ?? 0) * 100)))}%` }}
        />
        <span className="sg-finding-score tnum" dir="ltr">
          {f.confidence === null ? (ar ? 'بدون درجة' : 'no score') : `${Math.round(f.confidence * 100)}%`}
        </span>
      </div>
      <div className="sg-finding-basis" dir="auto">{f.confidenceBasis}</div>
      <div className="sg-finding-why">
        {f.why.map((code) => (
          <span key={code} className="sg-why" title={code}>
            {ar ? WHY_LABEL[code].ar : WHY_LABEL[code].en}
          </span>
        ))}
        <span className="sg-why sg-why--count tnum" dir="ltr">×{f.sightings}</span>
      </div>
      {f.evidence.length > 0 && (
        <ul className="sg-evidence">
          {f.evidence.map((e, i) => (
            <li key={`${e.source}-${i}`}>
              <span className="sg-ev-src" dir="ltr">{e.source}</span>
              {e.context && <span className="sg-ev-ctx" dir="auto">{e.context}</span>}
              <span className="sg-ev-text" dir="auto">{e.detail}</span>
              <span className="sg-ev-at tnum" dir="auto">{insightTime(e.at, ar)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------- profile chips ----------------

function ProfileChip({ label, onRemove, title }: { label: string; onRemove: () => void; title: string }) {
  return (
    <span className="dna-chip" title={title}>
      <span className="truncate max-w-[24ch]" dir="auto">
        {label}
      </span>
      <button className="dna-chip-x" aria-label={title} onClick={onRemove}>
        <X size={10} />
      </button>
    </span>
  );
}

// ---------------- main panel ----------------

/* ============================================================
   EDITORIAL ART — presentation only. Draws from data the panel
   already holds; no api call, store write or state binding added.
   Motion guarded by prefers-reduced-motion + html.reduce-motion.
   ============================================================ */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    if (
      (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
      root.classList.contains('reduce-motion') ||
      typeof IntersectionObserver === 'undefined'
    ) {
      el.setAttribute('data-in', 'true');
      return;
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        el.setAttribute('data-in', 'true');
        io.disconnect();
      }
    }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

/** Original 1px glyph — a ruled identity card with a small seal. */
function DnaGlyph() {
  return (
    <span className="dn-glyph" aria-hidden="true">
      <svg viewBox="0 0 72 34" fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round">
        <path d="M9 6h44v22H9z" />
        <path d="M15 13h20M15 18h20M15 23h13" opacity=".6" />
        <circle cx="49" cy="17" r="7" />
        <circle cx="49" cy="17" r="3" opacity=".6" />
        <circle className="dn-g-dot" cx="49" cy="17" r="1.2" />
      </svg>
    </span>
  );
}

/** The identity sheet: ruled hairlines, a geometric seal, honest values. */
function IdentitySheet({
  name, role, expertise, sessions, patterns, ar,
}: {
  name?: string; role?: string; expertise: string[]; sessions: number; patterns: number; ar: boolean;
}) {
  const ref = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className="dn-sheet dn-reveal">
      <div className="dn-sheet-fig">{ar ? 'اللوحة ٠٣ / ورقة الهوية' : 'PLATE 03 / IDENTITY SHEET'}</div>
      <div className="dn-sheet-body">
        {/* exact registration corners — SVG crop marks with 6px legs inset
            1px from the sheet, plus a crosshair at the exact centre (8,8).
            Each mark draws itself on mount in 60ms steps (tl→tr→br→bl). */}
        {(['tl', 'tr', 'br', 'bl'] as const).map((k, i) => (
          <svg key={k} className={`craft-reg craft-reg--${k}`} viewBox="0 0 16 16" aria-hidden="true">
            <g className="craft-reg-mark">
              <path className="craft-draw" pathLength={1} style={{ animationDelay: `${i * 60}ms` }}
                d={k === 'tl' ? 'M1 7V1H7' : k === 'tr' ? 'M15 7V1H9' : k === 'br' ? 'M15 9V15H9' : 'M1 9V15H7'} />
              <g className="craft-reg-cross">
                <circle className="craft-draw" pathLength={1} cx="8" cy="8" r="3" style={{ animationDelay: `${i * 60 + 60}ms` }} />
                <line className="craft-draw" pathLength={1} x1="8" y1="2" x2="8" y2="14" style={{ animationDelay: `${i * 60 + 120}ms` }} />
                <line className="craft-draw" pathLength={1} x1="2" y1="8" x2="14" y2="8" style={{ animationDelay: `${i * 60 + 180}ms` }} />
              </g>
            </g>
            <circle className="craft-reg-dot" cx="8" cy="8" r="0.9" />
          </svg>
        ))}
        <div className="dn-seal" aria-hidden="true">
          <svg viewBox="0 0 54 54">
            <circle className="dn-seal-ring" cx="27" cy="27" r="24" />
            <circle className="dn-seal-ring dn-seal-ring--dash" cx="27" cy="27" r="18" />
            <circle className="dn-seal-ring" cx="27" cy="27" r="11" />
            <path className="dn-seal-cross" d="M27 1v9M27 44v9M1 27h9M44 27h9" />
            <circle className="dn-seal-dot" cx="27" cy="27" r="2.4" />
            <text className="dn-seal-label" x="27" y="52" textAnchor="middle">DNA</text>
          </svg>
        </div>
        <div className="dn-sheet-name" dir="auto">{name || (ar ? 'بلا اسم' : 'Unnamed profile')}</div>
        <div className="dn-sheet-fig" style={{ marginTop: 2 }}>{role || (ar ? 'لم يُحدَّد دور' : 'No role recorded')}</div>
        <div className="dn-sheet-rule" />
        <div className="dn-sheet-row">
          <span className="dn-sheet-k">{ar ? 'خبرة' : 'expertise'}</span>
          <span className={'dn-sheet-v' + (expertise.length ? '' : ' is-empty')} dir="auto">
            {expertise.length ? expertise.slice(0, 4).join(' · ') : (ar ? 'لا شيء بعد' : 'nothing yet')}
          </span>
        </div>
        <div className="dn-sheet-rule" />
        <div className="dn-sheet-row">
          <span className="dn-sheet-k">{ar ? 'جلسات' : 'sessions'}</span>
          <span className="dn-sheet-v">{sessions}</span>
        </div>
        <div className="dn-sheet-rule" />
        <div className="dn-sheet-row">
          <span className="dn-sheet-k">{ar ? 'أنماط' : 'patterns'}</span>
          <span className="dn-sheet-v">{patterns}</span>
        </div>
      </div>
    </div>
  );
}

/** Playbook evolution timeline — EVEN node spacing from real version numbers. */
function PlaybookTimeline({ versions, ar }: { versions: number[]; ar: boolean }) {
  const ref = useInView<HTMLDivElement>();
  if (versions.length === 0) return null;
  const W = 540, H = 52, L = 18, R = 18;
  const span = W - L - R;
  const n = versions.length;
  const step = n > 1 ? span / (n - 1) : 0;
  const xOf = (i: number) => L + (n > 1 ? i * step : span / 2);
  const y = 24;
  return (
    <div ref={ref} className="pb-tl dn-reveal">
      <svg className="pb-tl-svg" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={ar ? 'خط تطور الدليل الحيّ' : 'Living playbook evolution timeline'}>
        <line className="pb-tl-base" x1={L} y1={y} x2={W - R} y2={y} />
        {versions.map((v, i) => (
          <g key={`${v}-${i}`}>
            <line className="pb-tl-tick" x1={xOf(i)} y1={y - 9} x2={xOf(i)} y2={y + 9} />
            <circle className={'pb-tl-node' + (i === n - 1 ? ' is-tip' : '')} cx={xOf(i)} cy={y} r={i === n - 1 ? 4.5 : 3.4} />
            <text className={'pb-tl-label' + (i === n - 1 ? ' is-tip' : '')} x={xOf(i)} y={y + 20} textAnchor="middle">v{v}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function DnaPanel() {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const dna = useStore((s) => s.dna);
  const dnaStats = useStore((s) => s.dnaStats);
  const dnaLoading = useStore((s) => s.dnaLoading);
  const wsPath = useStore((s) => s.wsPath);
  const skillsTrustNeeded = useStore((s) => s.skillsTrustNeeded);
  const loadDna = useStore((s) => s.loadDna);
  const trustWorkspaceSkills = useStore((s) => s.trustWorkspaceSkills);
  const notify = useStore((s) => s.notify);
  // v2.2 — the live agent suggestion (set by the store's onDnaEvent
  // 'suggestion' branch); the violet mark is the agent's identity sign.
  const suggestion = useStore((s) => s.dnaSuggestion);
  const clearDnaSuggestion = useStore((s) => s.clearDnaSuggestion);
  // v11.12 — Living Playbook (signature feature)
  const playbook = useStore((s) => s.playbook);
  const playbookHistory = useStore((s) => s.playbookHistory);
  const lastLearning = useStore((s) => s.lastPlaybookLearning);
  const loadPlaybook = useStore((s) => s.loadPlaybook);
  const clearPlaybook = useStore((s) => s.clearPlaybook);

  useEffect(() => {
    void loadPlaybook();
  }, [loadPlaybook]);

  // load on mount (rail view mounts on activation) — events keep it fresh
  useEffect(() => {
    void loadDna();
  }, [loadDna]);

  const patterns = useMemo(() => dna?.patterns ?? [], [dna]);
  // Only the newest 10 are rendered; the stamp must show the TRUE total so a
  // 25-entry memory never masquerades as "10 entries" (wrong-count fix).
  const feedback = useMemo(() => (dna?.feedback ?? []).slice(-10).reverse(), [dna]);
  const fbTotal = dnaStats?.feedback ?? dna?.feedback.length ?? feedback.length;
  const profile = dna?.profile;

  // v11.42 — READ-ONLY insights from the SAME `dna` store. No second api call,
  // no second source of truth: both pure functions come from signatureFeatures.
  const insight = useMemo(() => autopsyDNA({ dna: dna ?? {} }), [dna]);
  const promptVisible = useMemo(() => promptVisibleIds(dna ?? {}), [dna]);
  const L = (en: string, arText: string): string => (lang === 'ar' ? arText : en);

  const trustSupported = typeof api.skillsTrust === 'function';

  // Every edit below reconciles with disk via loadDna() AFTER it settles and
  // reports failures — a silent catch used to leave the panel showing data
  // that had already been removed on disk (stale state / dead control).
  const errMsg = () => t('misc.error', 'Something went wrong');
  const afterEdit = (): void => {
    void loadDna();
  };
  const editProfile = (patch: Record<string, unknown>): void => {
    void api
      .dnaUpdate({ section: 'profile', patch })
      .then(afterEdit)
      .catch(() => notify(errMsg()));
  };

  const forget = (scope: 'workspace' | 'all') => {
    const confirmMsg = scope === 'all' ? t('dna.forgetConfirmAll') : t('dna.forgetConfirmWs');
    if (!window.confirm(confirmMsg)) return;
    void (async () => {
      try {
        if (scope === 'all') await api.dnaClear('all');
        else await api.dnaClear('workspace', wsPath || undefined);
        notify(scope === 'all' ? t('dna.forgotAll') : t('dna.forgotWs'));
      } catch {
        notify(errMsg());
      } finally {
        // Always reconcile with disk — a failed clear must not leave a stale view.
        afterEdit();
      }
    })();
  };

  const empty =
    !!dna &&
    patterns.length === 0 &&
    feedback.length === 0 &&
    !profile?.name &&
    !profile?.role &&
    (profile?.expertise.length ?? 0) === 0 &&
    (profile?.languages.length ?? 0) === 0 &&
    (profile?.likes.length ?? 0) === 0 &&
    (profile?.dislikes.length ?? 0) === 0 &&
    (profile?.styleNotes.length ?? 0) === 0 &&
    (dna.stats.sessionsObserved ?? 0) === 0;

  return (
    <div
      className="page-v14 art-dna p-3 flex flex-col gap-3 overflow-y-auto min-h-0 h-full dna-panel"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
    >
      <PageHead
        eyebrow={lang === 'ar' ? '٠٣ / الحمض النووي' : '03 / DNA'}
        title={lang === 'ar' ? 'ذاكرة سديم عنك' : 'Your SADEEM DNA'}
        description={lang === 'ar'
          ? 'ملف محلي يوضح كيف تعمل. محفوظ على هذا الجهاز فقط.'
          : 'A local profile of how you work. Stored on this device only.'}
        toolbar={<DnaGlyph />}
      />
      {/* the instrument: a ruled identity sheet drawn from real DNA data */}
      <IdentitySheet
        name={dna?.profile?.name}
        role={dna?.profile?.role}
        expertise={dna?.profile?.expertise ?? []}
        sessions={dnaStats?.sessionsObserved ?? dna?.stats.sessionsObserved ?? 0}
        patterns={dnaStats?.patterns ?? patterns.length}
        ar={lang === 'ar'}
      />
      {/* ---------- agent-suggestion chip (violet = agent activity mark) ---------- */}
      {suggestion?.text && (
        <div
          className="aurora-panel p-2.5 anim-in"
          style={{ borderColor: 'color-mix(in srgb, var(--agent) 40%, var(--line))' }}
          role="status"
        >
          <div className="flex items-start gap-2">
            <IconTile icon={<IcDna size={12} />} tone="var(--agent)" size={22} />
            <div className="flex-1 min-w-0">
              <span
                className="stamp !h-[16px] !px-1.5 !text-[9px] mb-1"
                style={{
                  color: 'var(--agent)',
                  borderColor: 'color-mix(in srgb, var(--agent) 45%, transparent)',
                  background: 'color-mix(in srgb, var(--agent) 10%, transparent)',
                }}
              >
                {t('dna.suggestion', 'AGENT SUGGESTED')}
              </span>
              <div className="text-[11.5px] text-[var(--ink)] leading-snug break-words" dir="auto">
                {suggestion.text}
              </div>
            </div>
            <button
              className="shrink-0 rounded-[6px] p-1 text-faint hover:text-[var(--bad)] hover:bg-[var(--hover-2)] transition-colors"
              title={t('dna.suggestion.dismiss', 'Dismiss suggestion')}
              aria-label={t('dna.suggestion.dismiss', 'Dismiss suggestion')}
              onClick={clearDnaSuggestion}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* ---------- skills-trust consent card ---------- */}
      {skillsTrustNeeded && (
        <div
          className="aurora-panel p-3 anim-in"
          style={{ borderColor: 'color-mix(in srgb, var(--warn) 40%, var(--line))' }}
          role="alert"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <ShieldCheck size={14} className="text-warn shrink-0" />
            <span className="text-[11.5px] font-semibold">{t('dna.trust.title')}</span>
          </div>
          <div className="text-[11px] text-dim leading-relaxed mb-2">{t('dna.trust.body')}</div>
          {trustSupported && (
            <Btn variant="primary" className="!h-7 !px-2.5 !text-[11px]" onClick={() => void trustWorkspaceSkills()}>
              {t('dna.trust.btn')}
            </Btn>
          )}
        </div>
      )}

      {/* ---------- v11.12 — LIVING PLAYBOOK (signature feature) ---------- */}
      {(playbook || lastLearning) && (
        <PlaybookCard
          playbook={playbook}
          history={playbookHistory}
          lastLearning={lastLearning}
          lang={lang}
          t={t}
          onClear={clearPlaybook}
        />
      )}

      {/* ---------- loading skeleton ---------- */}
      {dnaLoading && !dna && (
        <div className="aurora-panel p-3">
          <SectionTitle>{t('dna.loading')}</SectionTitle>
          <div className="flex flex-col gap-2 py-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skel-row skeleton-shimmer" />
            ))}
          </div>
        </div>
      )}

      {/* ---------- empty state (fresh install / load failure / truly empty) ---------- */}
      {!dnaLoading && (!dna || empty) ? (
        <div className="blank-state hero-grid aurora-panel-lg !py-8">
          <IcDna size={26} />
          <div className="bs-title !text-[13px]">{t('dna.emptyTitle')}</div>
          <div className="bs-sub">{t('dna.emptySub')}</div>
          <details className="dna-how">
            <summary>
              <ChevronDown size={11} className="dna-how-caret" />
              {t('dna.howTitle')}
            </summary>
            <ol className="dna-how-list">
              <li>
                <span className="tnum dna-how-no">01</span>
                {t('dna.how1')}
              </li>
              <li>
                <span className="tnum dna-how-no">02</span>
                {t('dna.how2')}
              </li>
              <li>
                <span className="tnum dna-how-no">03</span>
                {t('dna.how3')}
              </li>
            </ol>
          </details>
        </div>
      ) : null}

      {/* ---------- growth strip (stat tiles) ---------- */}
      {dna && !empty && (
        <div className="grid grid-cols-3 gap-1.5 shrink-0">
          <div className="wscc-tile tick-frame" title={t('dna.tile.sessions')}>
            <span className="wscc-tile-label">{t('dna.tile.sessions')}</span>
            <span className="wscc-tile-value tnum" dir="ltr">
              {(dnaStats?.sessionsObserved ?? dna.stats.sessionsObserved ?? 0).toLocaleString()}
            </span>
          </div>
          <div className="wscc-tile tick-frame" title={t('dna.tile.facts')}>
            <span className="wscc-tile-label">{t('dna.tile.facts')}</span>
            <span className="wscc-tile-value tnum" dir="ltr">
              {(dna.stats.factsRecorded ?? 0).toLocaleString()}
            </span>
          </div>
          <div className="wscc-tile tick-frame" title={t('dna.tile.patterns')}>
            <span className="wscc-tile-label">{t('dna.tile.patterns')}</span>
            <span className="wscc-tile-value tnum" dir="ltr">
              {(dnaStats?.patterns ?? patterns.length).toLocaleString()}
            </span>
          </div>
        </div>
      )}
      {dna && !empty && (
        <div className="flex items-center gap-2 text-[10.5px] text-faint -mt-1.5 shrink-0">
          <IconTile icon={<IcDna size={12} />} tone="var(--acc)" size={18} />
          <span className="micro-label !mb-0 shrink-0">{t('dna.growth')}</span>
          <span className="tnum truncate min-w-0" dir="ltr">
            {t('dna.updatedAt')}:{' '}
            {dna.stats.updatedAt ? relTime(dna.stats.updatedAt, lang) : t('dna.never')}
          </span>
        </div>
      )}

      {/* ---------- 01 — PROFILE ---------- */}
      {dna && (
        <div className="aurora-panel p-3" title={t('dna.profile.tip')}>
          <SectionTitle no="01" title={t('dna.profile')} />
          {!profile?.name && !profile?.role && (profile?.expertise.length ?? 0) === 0 && (
            <div className="text-[10.5px] text-faint leading-relaxed mb-1">{t('dna.profileEmpty')}</div>
          )}
          <div className="flex flex-col gap-2 mt-1">
            {/* name / role — single-value chips */}
            {(profile?.name || profile?.role) && (
              <div className="flex flex-wrap gap-1.5 items-center">
                {profile?.name && (
                  <ProfileChip
                    label={profile.name}
                    title={t('dna.name')}
                    onRemove={() => editProfile({ name: '' })}
                  />
                )}
                {profile?.role && (
                  <ProfileChip
                    label={profile.role}
                    title={t('dna.role')}
                    onRemove={() => editProfile({ role: '' })}
                  />
                )}
              </div>
            )}
            {ARRAY_FIELDS.map(({ field, labelKey, phKey }) => {
              const items = profile?.[field] ?? [];
              return (
                <ProfileSection
                  key={field}
                  label={t(labelKey)}
                  ph={t(phKey)}
                  items={items}
                  onAdd={(v) => editProfile({ [field]: [...items, v] })}
                  onRemove={(v) => editProfile({ [field]: items.filter((x) => x !== v) })}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ---------- 02 — LEARNED PATTERNS ---------- */}
      {dna && (
        <div className="aurora-panel p-3" title={t('dna.patterns.tip')}>
          <div className="flex items-center">
            <SectionTitle no="02" title={t('dna.patterns')} />
            {patterns.length > 0 && (
              <span className="stamp !h-[15px] !text-[9px] tnum mb-1 shrink-0" title={t('dna.patterns.tip')}>
                {t('dna.patternCount').replace('{n}', String(patterns.length))}
              </span>
            )}
          </div>
          {patterns.length === 0 ? (
            <div className="text-[10.5px] text-faint mt-1">{t('dna.patternEmpty')}</div>
          ) : (
            <div className="rounded-[8px] border border-line overflow-hidden mt-1">
              {patterns.slice(0, 60).map((p) => (
                <div className="keyrow" key={p.id} title={p.text}>
                  <span className={`stamp !h-[14px] !px-1 !text-[8.5px] shrink-0 ${KIND_STAMP[p.kind]}`}>
                    {p.kind.toUpperCase()}
                  </span>
                  <span className="key-main min-w-0">
                    <span className="key-title !text-[11px] truncate max-w-[26ch]" dir="auto">
                      {p.text}
                    </span>
                    <span className="key-sub flex items-center gap-1.5">
                      <span className="dna-conf" title={`${t('dna.confidence')}: ${Math.round(p.confidence * 100)}%`}>
                        <span
                          className={`dna-conf-fill ${p.confidence < 0.6 ? 'is-low' : ''}`}
                          style={{ width: `${Math.max(4, Math.round(p.confidence * 100))}%` }}
                        />
                      </span>
                      <span className="tnum" dir="ltr" title={t('dna.countTip').replace('{n}', String(p.count))}>
                        ×{p.count}
                      </span>
                      <span className="tnum" dir="auto" title={t('dna.lastSeen')}>
                        {relTime(p.lastSeen, lang)}
                      </span>
                    </span>
                  </span>
                  <button
                    className="ibtn !w-8 !h-8 !-my-2 shrink-0"
                    title={t('dna.removePattern')}
                    aria-label={t('dna.removePattern')}
                    onClick={() => {
                      void api.dnaUpdate({ section: 'patterns', id: p.id }).then(afterEdit).catch(() => notify(errMsg()));
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- 03 — DNA INSIGHTS (v11.42 · read-only, collapsible) ---------- */}
      {dna && (
        <details
          className="aurora-panel p-3 dna-insights"
          open
          title={t('dna.insights.tip', L(
            'Read-only explanation of the same stored DNA, plus prompt visibility.',
            'تفسير للقراءة فقط لنفس الحمض المخزّن، مع بيان ظهوره في الموجّه.',
          ))}
        >
          <summary className="dna-insights-head">
            <ChevronDown size={11} className="dna-insights-caret" aria-hidden="true" />
            <span className="sec-no">03</span>
            <span className="micro-label !mb-0">
              {t('dna.insights.title', L('DNA INSIGHTS', 'رؤى الحمض'))}
            </span>
            <span className="sec-rule" />
            <span
              className="stamp !h-[15px] !text-[9px] tnum shrink-0"
              title={t('dna.insights.promptTip', L(
                'Patterns the real prompt builder will inject into the next run',
                'الأنماط التي سيحقنها باني الموجّه في التشغيل التالي',
              ))}
            >
              {promptVisible.size}/{insight.summary.promptSlots} {t('dna.insights.inPrompt', L('in prompt', 'في الموجّه'))}
            </span>
          </summary>
          <div className="sg-toolbar">
            <span className="sg-toolbar-stat tnum" dir="ltr">
              {insight.summary.factsRecorded} {t('dna.tile.facts')} · {insight.summary.sessionsObserved} {t('dna.tile.sessions')}
              {' · '}{insight.summary.activePatterns}/{insight.summary.promptSlots} {t('dna.insights.inPrompt', L('in prompt', 'في الموجّه'))}
            </span>
          </div>
          {insight.findings.length === 0 ? (
            <p className="sg-empty">
              {t('dna.insights.empty', L(
                'No learned facts are stored yet. DNA grows only from observed runs and your explicit feedback.',
                'لا توجد حقائق متعلَّمة بعد. ينمو الحمض النووي من التشغيلات الملحوظة وملاحظاتك الصريحة فقط.',
              ))}
              <span className="sg-code" dir="ltr">{insight.emptyReason}</span>
            </p>
          ) : (
            <ul className="sg-findings">
              {insight.findings.map((f) => <FindingRow key={f.id} f={f} ar={lang === 'ar'} />)}
            </ul>
          )}
          <p className="sg-caveat">
            {t('dna.insights.caveat', L(
              'Advisory only. Each explanation is derived from stored fields; it is not a claim the AI made about itself.',
              'توجيهي فقط. كل تفسير مشتق من حقول محفوظة، وليس ادعاءً من الذكاء الاصطناعي عن نفسه.',
            ))}
            <span className="sg-code" dir="ltr">{insight.caveat}</span>
          </p>
        </details>
      )}

      {/* ---------- 04 — FEEDBACK TIMELINE ---------- */}
      {dna && (
        <div className="aurora-panel p-3" title={t('dna.feedback.tip')}>
          <div className="flex items-center">
            <SectionTitle no="04" title={t('dna.feedback')} />
            {feedback.length > 0 && (
              <>
                <span className="stamp stamp-clay !h-[15px] !text-[9px] tnum mb-1 shrink-0" title={t('dna.feedback.tip')}>
                  {t('dna.fbCount').replace('{n}', String(fbTotal))}
                </span>
                {fbTotal > feedback.length && (
                  <span className="text-[9px] text-faint mb-1 shrink-0" dir="ltr">
                    {t('dna.fbShown', 'last {n} shown', { n: String(feedback.length) })}
                  </span>
                )}
              </>
            )}
          </div>
          {feedback.length === 0 ? (
            <div className="text-[10.5px] text-faint mt-1">{t('dna.fbEmpty')}</div>
          ) : (
            <div className="rounded-[8px] border border-line overflow-hidden mt-1">
              {feedback.map((f, i) => (
                <div className="keyrow" key={`${f.ts}-${i}`}>
                  <span className={`stamp !h-[14px] !px-1 !text-[8.5px] shrink-0 ${FB_STAMP[f.kind]}`} title={t(`dna.fb.${f.kind}`)}>
                    {f.kind.toUpperCase()}
                  </span>
                  <span className="key-main min-w-0">
                    <span className="key-title !text-[11px]" dir="auto">
                      {f.note}
                    </span>
                    {f.context && (
                      <span className="key-sub truncate max-w-[34ch]" dir="auto" title={`${t('dna.fb.contextTip')}: ${f.context}`}>
                        {f.context}
                      </span>
                    )}
                  </span>
                  <span className="tnum text-[9.5px] text-faint shrink-0" dir="auto">
                    {relTime(f.ts, lang)}
                  </span>
                  {/* v2.3 — per-entry forget: a wrong "correction" must never
                      linger and become a fake rule the model obeys. */}
                  <button
                    className="shrink-0 rounded-[2px] p-0.5 text-faint hover:text-bad hover:bg-[var(--hover-2)] transition-colors"
                    title={t('dna.fb.forget', 'Forget this entry')}
                    aria-label={t('dna.fb.forget', 'Forget this entry')}
                    onClick={() => {
                      void api
                        .dnaUpdate({ section: 'feedback', id: String(f.ts) })
                        .then(afterEdit) // refresh — otherwise the forgotten entry stays on screen
                        .catch(() => notify(errMsg()));
                    }}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- privacy bar ---------- */}
      <div className="aurora-panel p-3">
        <div className="flex items-start gap-2">
          <ShieldCheck size={13} className="text-ok shrink-0 mt-0.5" />
          <div className="text-[10.5px] text-dim leading-relaxed flex-1 min-w-0">
            <span className="stamp stamp-acc !h-[15px] !text-[9px] mb-1">{t('dna.privacy.title')}</span>
            <div>{t('dna.privacy')}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2.5">
          <Btn
            className="!h-7 !px-2.5 !text-[11px]"
            disabled={!wsPath}
            title={t('dna.forget.tip')}
            onClick={() => forget('workspace')}
          >
            {t('dna.forgetWs')}
          </Btn>
          <Btn
            variant="danger"
            className="!h-7 !px-2.5 !text-[11px]"
            title={t('dna.forgetAll.tip')}
            onClick={() => forget('all')}
          >
            {t('dna.forgetAll')}
          </Btn>
          {dnaLoading && <Spinner size={12} />}
        </div>
      </div>
    </div>
  );
}

/** One profile array section: label + chips + inline add input. */
function ProfileSection({
  label,
  ph,
  items,
  onAdd,
  onRemove,
}: {
  label: string;
  ph: string;
  items: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    if (!items.some((x) => x.toLowerCase() === v.toLowerCase())) onAdd(v);
    setDraft('');
    inputRef.current?.focus();
  };
  return (
    <div>
      <div className="micro-label mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {items.map((it) => (
          <ProfileChip key={it} label={it} title={t('dna.remove')} onRemove={() => onRemove(it)} />
        ))}
        <input
          ref={inputRef}
          className="dna-add"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              setDraft('');
            }
          }}
          placeholder={ph}
          title={t('dna.addTip')}
          aria-label={`${label} — ${t('dna.addTip')}`}
          dir="auto"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

/* ---------------- v11.12 — Living Playbook card ---------------- */

const PB_LABEL: Record<PlaybookChange['section'], string> = {
  worked: 'WORKED',
  failed: 'FAILED',
  preferences: 'PREF',
  recipes: 'RECIPE',
};
const PB_SIGN: Record<PlaybookChange['action'], string> = {
  added: '+',
  reinforced: '↑',
  removed: '−',
};

function PlaybookCard({
  playbook,
  history,
  lastLearning,
  lang,
  t,
  onClear,
}: {
  playbook: PlaybookData | null;
  history: PlaybookRevision[];
  lastLearning: { summary: string; version: number; ts: number } | null;
  lang: string;
  t: (k: string, fb?: string) => string;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const notice = playbook?.lastLearned || lastLearning?.summary || '';
  const version = playbook?.version ?? lastLearning?.version ?? 0;
  const total =
    (playbook?.worked.length ?? 0) +
    (playbook?.failed.length ?? 0) +
    (playbook?.preferences.length ?? 0) +
    (playbook?.recipes.length ?? 0);

  return (
    <div
      className="aurora-panel p-3 anim-in"
      style={{ borderColor: 'color-mix(in srgb, var(--agent) 38%, var(--line))' }}
      title={t('pb.tip', 'The agent rewrites this field guide after every run and injects it into the next one.')}
    >
      <div className="flex items-center gap-2">
        <IconTile icon={<IcDna size={12} />} tone="var(--agent)" size={20} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="micro-label !mb-0">{t('pb.title', 'LIVING PLAYBOOK')}</span>
            <span className="stamp !h-[14px] !px-1 !text-[8.5px] pb-version" title={t('pb.version', 'Evolution version')}>
              v{version}
            </span>
          </div>
          <div className="text-[9.5px] text-faint">{t('pb.sub', 'Learned from real runs · injected into the next run')}</div>
        </div>
        <span className="stamp !h-[15px] !text-[9px] tnum shrink-0" title={t('pb.countTip', 'Learned lessons')}>
          {total}
        </span>
      </div>

      {notice && (
        <div className="pb-learned mt-2" role="status">
          <div className="pb-learned-tag text-[9px] uppercase tracking-wide">
            {t('pb.learned', 'SADEEM learned')}
          </div>
          <div className="text-[11px] text-[var(--ink)] leading-snug break-words" dir="auto">
            {notice}
          </div>
        </div>
      )}

      {!notice && total === 0 && (
        <div className="pb-empty mt-2">{t('pb.empty', 'The playbook grows after your first completed run.')}</div>
      )}

      {/* evolution timeline — evenly spaced nodes from real versions */}
      <PlaybookTimeline versions={history.map((h) => h.version)} ar={lang === 'ar'} />
      <button
        className="mt-2 flex items-center gap-1 text-[10px] text-dim hover:text-[var(--ink)] transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronDown size={11} className="dna-how-caret" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
        {t('pb.timeline', 'Evolution timeline')} ({history.length})
      </button>
      {open && (
        <>
          {history.length === 0 ? (
            <div className="pb-empty mt-2">{t('pb.noHistory', 'No revisions yet — each learning step creates a version here.')}</div>
          ) : (
            <div className="pb-timeline">
              {history.slice(0, 12).map((rev) => (
                <div className="pb-rev" key={`${rev.version}-${rev.ts}`}>
                  <div className="pb-rev-head">
                    <span className="stamp pb-version !h-[14px] !px-1 !text-[8.5px] tnum">v{rev.version}</span>
                    <span className="tnum text-[9px] text-faint">{relTime(rev.ts, lang)}</span>
                  </div>
                  {rev.summary && <div className="pb-rev-summary" dir="auto">{rev.summary}</div>}
                  {rev.changes.slice(0, 6).map((c, i) => (
                    <div className={`pb-change ${c.action}`} key={`${c.section}-${i}`} dir="auto">
                      <span className="pb-change-sign" title={c.action}>{PB_SIGN[c.action]}</span>
                      <span className="stamp !h-[13px] !px-1 !text-[8px] shrink-0">{PB_LABEL[c.section]}</span>
                      <span className="min-w-0 break-words">{c.text}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end mt-2">
            <button className="text-[9.5px] text-faint hover:text-[var(--bad)] transition-colors" onClick={onClear}>
              {t('pb.forget', 'Forget playbook')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default DnaPanel;
