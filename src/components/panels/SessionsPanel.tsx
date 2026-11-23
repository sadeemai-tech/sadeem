// SessionsPanel — sessions grouped by recency (SURVEYOR v4).
// keyrow list: title · state stamp (RUN / IDLE / DONE / ERR) · mono meta
// (msgs · tokens · cost) · hover actions (fork / export / recap / rename /
// delete; click or ↵ opens). The Scheduled tab embeds SchedulePanel so cron
// jobs live with sessions — never an orphan feature.
// A9: below the list, the RUN JOURNEYS section surfaces the v9 crash-resilient
// run journals (api.journalList / journalRead) for hours-long task oversight —
// newest 10 with outcome stamps + an inline event timeline (tool name ·
// ok/fail dot · ms; continue rounds; finish). Killed/crashed runs read
// UNFINISHED and carry the resume note.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, ChevronDown, ChevronUp, Folder, GitFork, MessagesSquare, Pencil, Plus, RotateCw, ScrollText, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import type { JournalEvent, JournalSummary } from '../../lib/api';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { Btn, Empty, IconBtn, MOD_KEY, shortModel, Spinner, TextInput } from '../ui';
import { PageHead } from '../pages';
import { SchedulePanel } from './SchedulePanel';
import type { SessionMeta } from '../../../shared/types';
// FINAL LAUNCH POLISH — editorial art layer (loaded last so it wins ties).
import './hgs-art.css';
// v11.11 (A9-DESIGN) — hand-authored empty-state illustration (license-clean SVG;
// the calm lantern already greets Home + Welcome — same art for the sessions list)
import emptySessions from '../../assets/illustrations/empty-sessions.svg';

type TFn = ReturnType<typeof useT>;

const base = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

/** Localized relative time: "now", "5m ago", "2h ago", "3d ago", then a date. */
function relTime(ts: number, t: TFn): string {
  const d = Date.now() - ts;
  if (d < MIN_MS) return t('time.now', 'now');
  let n: number;
  let unit: string;
  if (d < HOUR_MS) {
    n = Math.floor(d / MIN_MS);
    unit = t('time.m', 'm');
  } else if (d < DAY_MS) {
    n = Math.floor(d / HOUR_MS);
    unit = t('time.h', 'h');
  } else if (d < 7 * DAY_MS) {
    n = Math.floor(d / DAY_MS);
    unit = t('time.d', 'd');
  } else {
    return new Date(ts).toLocaleDateString();
  }
  return t('time.ago', '{0} ago').replace('{0}', `${n}${unit}`);
}

/** Local calendar date key (YYYY-MM-DD) for a timestamp. */
const dayKey = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type GroupId = 'today' | 'yesterday' | 'week' | 'earlier';

const GROUP_ORDER: GroupId[] = ['today', 'yesterday', 'week', 'earlier'];

function groupKeyOf(ts: number): GroupId {
  const today = new Date();
  const yesterday = new Date(today.getTime() - DAY_MS);
  const weekAgo = new Date(today.getTime() - 7 * DAY_MS);
  const key = dayKey(ts);
  if (key === dayKey(today.getTime())) return 'today';
  if (key === dayKey(yesterday.getTime())) return 'yesterday';
  if (ts >= weekAgo.getTime()) return 'week';
  return 'earlier';
}

const GROUP_LABEL: Record<GroupId, { key: string; fb: string }> = {
  today: { key: 'sess.today', fb: 'Today' },
  yesterday: { key: 'sess.yesterday', fb: 'Yesterday' },
  week: { key: 'sess.earlierWeek', fb: 'Earlier this week' },
  earlier: { key: 'sess.earlier', fb: 'Earlier' },
};

/** Session lifecycle stamp — RUN / IDLE / DONE / ERR. */
function sessionStamp(
  s: SessionMeta,
  isActive: boolean,
  agentRunning: boolean,
  t: TFn,
): { label: string; cls: string; title: string } {
  if (isActive && agentRunning) return { label: t('sess.st.run', 'RUN'), cls: 'stamp-acc', title: t('sess.running', 'running') };
  if (isActive) return { label: t('sess.st.idle', 'IDLE'), cls: 'stamp-warn', title: t('sess.st.idleHint', 'open, idle') };
  // ERR is reserved for failed runs — the metadata does not carry it today;
  // the branch stays so the contract is complete if the backend adds a flag.
  if ((s as SessionMeta & { lastError?: boolean }).lastError)
    return { label: t('sess.st.err', 'ERR'), cls: 'stamp-bad', title: t('sess.st.errHint', 'last run failed') };
  if (s.messageCount > 0) return { label: t('sess.st.done', 'DONE'), cls: '', title: t('sess.done', 'done') };
  return { label: t('sess.st.empty', 'EMPTY'), cls: '', title: t('sess.empty', 'Empty') };
}

/* An original 1px glyph — a stack of dated cards with edges aligned on the
   same left/right rails, each card carrying a date tick and a register dot. */
function SessionsGlyph() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="11" y="8" width="27" height="11" rx="1.2" opacity=".5" />
      <rect x="11" y="19" width="27" height="11" rx="1.2" opacity=".75" />
      <rect x="11" y="30" width="27" height="11" rx="1.2" />
      <path d="M15 13h9M15 24h9M15 35h9" opacity=".55" />
      <circle cx="34" cy="13" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="34" cy="24" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="34" cy="35" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* Status glyph vocabulary — shape, not colour alone, carries state. */
type TLStatus = 'run' | 'idle' | 'done' | 'err';
function TimelineGlyph({ status }: { status: TLStatus }) {
  if (status === 'run') return (
    <svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" /><circle cx="6" cy="6" r="1.7" fill="currentColor" /></svg>
  );
  if (status === 'err') return (
    <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.4" y="2.4" width="7.2" height="7.2" fill="none" stroke="currentColor" /></svg>
  );
  if (status === 'done') return (
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.8 10.2 6 6 10.2 1.8 6Z" fill="currentColor" /></svg>
  );
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="3.4" fill="none" stroke="currentColor" strokeDasharray="2 2" /></svg>
  );
}

/* A session timeline with aligned date ticks + status glyphs, drawn from the
   live session list (oldest → newest along the axis). */
function SessionTimeline({ sessions, activeId, agentRunning, lang }: {
  sessions: SessionMeta[];
  activeId: string | null;
  agentRunning: boolean;
  lang: 'ar' | 'en';
}) {
  const t = useT();
  const ordered = sessions.slice(0, 8).reverse();
  const statusOf = (s: SessionMeta): TLStatus => {
    if (s.id === activeId) return agentRunning ? 'run' : 'idle';
    if ((s as SessionMeta & { lastError?: boolean }).lastError) return 'err';
    if (s.messageCount > 0) return 'done';
    return 'idle';
  };
  const dateOf = (s: SessionMeta): string =>
    new Date(s.updatedAt).toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { month: 'short', day: 'numeric' });
  return (
    <div className="hgs-timeline" aria-label={t('hgs.sess.timeline', lang === 'ar' ? 'الخط الزمني للجلسات' : 'Session timeline')}>
      <div className="hgs-timeline-head">
        <span className="hgs-mono">{t('hgs.sess.timelineLabel', lang === 'ar' ? 'الخط الزمني / الجلسات' : 'SESSION TIMELINE')}</span>
        <span className="hgs-chart-rule" aria-hidden />
        <span className="hgs-mono tnum" dir="ltr">{String(sessions.length).padStart(2, '0')}</span>
      </div>
      {ordered.length === 0 ? (
        <div className="hgs-timeline-empty">
          {t('hgs.sess.timelineEmpty', lang === 'ar' ? 'لا توجد جلسات بعد.' : 'No sessions on the timeline yet.')}
        </div>
      ) : (
        <div className="hgs-ticks">
          {ordered.map((s) => {
            const st = statusOf(s);
            return (
              <div key={s.id} className="hgs-tick" data-status={st} title={s.title}>
                <span className="hgs-tick-glyph"><TimelineGlyph status={st} /></span>
                <span className="hgs-tick-date">{dateOf(s)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── A9 — RUN JOURNEYS (crash-resilient run-journal oversight) ──────────────

const JOURNAL_ROWS = 10; // newest journals listed
const JOURNAL_PAGE = 40; // first event page fetched on expand
const JOURNAL_PAGE_MORE = 100; // each 'Load more' click grows the tail by this
const TASK_TRUNC = 60; // row task truncation (A9 contract)

/** Truncate a task line for the journal row (60 chars). */
const truncTask = (s: string, n = TASK_TRUNC): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Compact tool duration: '830ms' under a second, '4.2s' above. */
const fmtMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

/** Wall-clock HH:MM:SS for timeline rows — hours-long runs need real times. */
const evTime = (ts?: number): string =>
  typeof ts === 'number' && ts > 0
    ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '--:--:--';

/**
 * Outcome stamp for one journal row — completed (ok tone) / aborted (bad tone)
 * / no finish line → UNFINISHED (warn tone; the run was killed or crashed).
 * Unknown outcome strings render as a neutral stamp with the raw value.
 */
function outcomeStamp(
  j: JournalSummary,
  t: TFn,
): { label: string; cls: string; title: string; unfinished: boolean } {
  if (!j.outcome) {
    return {
      label: t('jn.st.unfinished', 'Unfinished'),
      cls: 'stamp-warn',
      title: t(
        'jn.unfinishedNote',
        'The run was killed or crashed — resume by starting a new session with the same task.',
      ),
      unfinished: true,
    };
  }
  if (j.outcome === 'completed')
    return { label: t('jn.st.done', 'Completed'), cls: 'stamp-acc', title: j.outcome, unfinished: false };
  if (j.outcome === 'aborted')
    return { label: t('jn.st.aborted', 'Aborted'), cls: 'stamp-bad', title: j.outcome, unfinished: false };
  return { label: j.outcome.toUpperCase(), cls: '', title: j.outcome, unfinished: false };
}

/**
 * One compact monospace timeline row: time · ok/fail dot · label · duration.
 * Shapes mirror electron/agent/journal.ts writers: {type:'tool', name, ok, ms},
 * {type:'continue', round}, {type:'finish', outcome} and the {type:'run'}
 * header. Unknown types degrade to a dim generic row — never a crash.
 */
function journalEventRow(ev: JournalEvent, i: number, t: TFn): React.ReactNode {
  const type = typeof ev.type === 'string' ? ev.type : '';
  const time = evTime(typeof ev.at === 'number' ? ev.at : undefined);
  let dot = 'var(--faint)';
  let label = type || t('jn.ev.event', 'event');
  let right = '';
  if (type === 'tool') {
    dot = ev.ok === true ? 'var(--ok)' : 'var(--bad)';
    label = typeof ev.name === 'string' && ev.name ? ev.name : 'tool';
    right = typeof ev.ms === 'number' ? fmtMs(ev.ms) : '';
  } else if (type === 'continue') {
    dot = 'var(--warn)';
    label =
      typeof ev.round === 'number'
        ? t('jn.ev.continue', 'continue · round {n}', { n: ev.round })
        : t('jn.ev.continuePlain', 'continue');
  } else if (type === 'finish') {
    const o = typeof ev.outcome === 'string' ? ev.outcome : '';
    dot = o === 'completed' ? 'var(--ok)' : o ? 'var(--bad)' : 'var(--faint)';
    label = o ? t('jn.ev.finishOutcome', 'finish · {o}', { o }) : t('jn.ev.finish', 'finish');
  } else if (type === 'run') {
    dot = 'var(--acc)';
    label = t('jn.ev.start', 'run start');
  }
  return (
    <div key={i} role="listitem" className="flex items-center gap-2 px-1 py-[3px] text-[11px] min-w-0" dir="ltr">
      <span className="tnum text-[10px] text-ghost shrink-0 w-[62px]" title={time}>
        {time}
      </span>
      <span
        aria-hidden="true"
        className="w-[7px] h-[7px] rounded-full shrink-0"
        style={{ background: dot }}
      />
      <span className="min-w-0 truncate flex-1">{label}</span>
      {right ? <span className="tnum text-[10px] text-faint shrink-0">{right}</span> : null}
    </div>
  );
}

/**
 * Rename ANY session — including inactive ones. The store's renameSession is
 * a no-op unless the row is the active chat, which made every other row's
 * pencil a dead control. Exported so the disk-write + refresh path can be
 * exercised directly (SSR has no renderer for multi-step UI interactions).
 */
export async function renameRecord(
  id: string,
  title: string,
  activeId: string | null,
  renameActive: (id: string, title: string) => Promise<void>,
): Promise<boolean> {
  if (activeId === id) {
    // Active session — the store updates chat state and persists it.
    await renameActive(id, title);
  } else {
    // Inactive session — edit the persisted record directly.
    try {
      const data = await api.loadSession(id);
      if (!data) return false;
      await api.saveSession({ ...data, title, updatedAt: Date.now() });
    } catch {
      return false;
    }
  }
  // Both paths must refresh the list: renameSession never reloads it, so
  // without this the row keeps the old title on screen (stale state).
  try {
    const list = await api.listSessions();
    useStore.setState({ sessions: list || [] });
  } catch {
    /* best effort */
  }
  return true;
}

export function SessionsPanel({ embedded }: { embedded?: boolean }) {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.session?.id ?? null);
  const agentRunning = useStore((s) => s.running);
  const openSession = useStore((s) => s.openSession);
  const newSession = useStore((s) => s.newSession);
  const deleteSession = useStore((s) => s.deleteSession);
  const renameSession = useStore((s) => s.renameSession);
  const notify = useStore((s) => s.notify);
  // v3.1: boot gate — sessions stream in during init(); show the skeleton
  // instead of flashing the "No sessions" empty state on every cold start.
  const booted = useStore((s) => s.booted);

  // tab switcher: transcript list ↔ scheduled cron jobs
  const [tab, setTab] = useState<'sessions' | 'schedule'>('sessions');
  // /schedule (composer slash) opens the Scheduled tab via the store flag
  const scheduledOpen = useStore((s) => s.scheduledOpen);
  const setScheduled = useStore((s) => s.setScheduled);
  useEffect(() => {
    if (scheduledOpen) {
      setTab('schedule');
      setScheduled(false); // consume the one-shot flag
    }
  }, [scheduledOpen, setScheduled]);
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const sorted = useMemo(() => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt), [sessions]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((s) => s.title.toLowerCase().includes(q));
  }, [sorted, query]);

  // group the filtered list by recency bucket
  const groups = useMemo(() => {
    const map = new Map<GroupId, SessionMeta[]>();
    for (const s of filtered) {
      const g = groupKeyOf(s.updatedAt);
      const arr = map.get(g);
      if (arr) arr.push(s);
      else map.set(g, [s]);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ id: g, items: map.get(g)! }));
  }, [filtered]);

  // ── A9 — run journals: newest 10, expandable event timelines ──
  const [journals, setJournals] = useState<JournalSummary[]>([]);
  const [jLoading, setJLoading] = useState(true);
  const [jFailed, setJFailed] = useState(false);
  const [jExpanded, setJExpanded] = useState<string | null>(null); // expanded journal file path
  const [jEvents, setJEvents] = useState<JournalEvent[] | null>(null);
  const [jLimit, setJLimit] = useState(JOURNAL_PAGE); // current tail-window size
  const [jEvLoading, setJEvLoading] = useState(false);
  // one-shot sequence guard: a slow read of journal A must never land as
  // journal B's events after the user switches rows mid-flight
  const jReqRef = useRef(0);

  // newest-first summaries; auto-refresh on mount (A9) + manual refresh button
  const loadJournals = useCallback(async () => {
    setJLoading(true);
    try {
      const list = await api.journalList(JOURNAL_ROWS);
      setJournals(Array.isArray(list) ? list : []);
      setJFailed(false);
    } catch {
      setJFailed(true);
    } finally {
      setJLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadJournals();
  }, [loadJournals]);

  // tail read of one journal (40 first, then +100 per 'more')
  const loadJournalEvents = async (file: string, limit: number) => {
    const seq = ++jReqRef.current;
    setJEvLoading(true);
    try {
      const evs = await api.journalRead(file, limit);
      if (seq !== jReqRef.current) return; // superseded by a newer read
      setJEvents(Array.isArray(evs) ? evs : []);
    } catch {
      if (seq !== jReqRef.current) return;
      setJEvents([]);
      notify(t('jn.evFailed', 'Could not read the journal'));
    } finally {
      if (seq === jReqRef.current) setJEvLoading(false);
    }
  };

  const toggleJournal = (file: string) => {
    if (jExpanded === file) {
      setJExpanded(null);
      setJEvents(null);
      return;
    }
    setJExpanded(file);
    setJEvents(null);
    setJLimit(JOURNAL_PAGE);
    void loadJournalEvents(file, JOURNAL_PAGE);
  };

  const moreJournalEvents = () => {
    if (!jExpanded) return;
    const next = jLimit + JOURNAL_PAGE_MORE;
    setJLimit(next);
    void loadJournalEvents(jExpanded, next);
  };

  const startRename = (id: string, title: string) => {
    setRenamingId(id);
    setDraft(title);
  };

  const commitRename = () => {
    const id = renamingId;
    const title = draft.trim();
    setRenamingId(null);
    if (!id || !title) return;
    void renameRecord(id, title, useStore.getState().session?.id ?? null, renameSession).then((ok) => {
      if (!ok) notify(t('misc.error', 'Error'));
    });
  };

  // fork the session (api.sessionFork) — refresh the list, notify
  const forkSession = async (id: string) => {
    try {
      const res = await api.sessionFork(id);
      if (res.ok) {
        notify(t('sess.forked', 'Session forked'));
        const list = await api.listSessions();
        useStore.setState({ sessions: list });
      } else {
        notify(res.error ?? t('misc.error', 'Error'));
      }
    } catch {
      notify(t('misc.error', 'Error'));
    }
  };

  // export the transcript as Markdown → download via blob
  const exportSession = async (s: SessionMeta) => {
    try {
      const res = await api.sessionExport(s.id);
      if (res.markdown) {
        const blob = new Blob([res.markdown], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(s.title || 'session').replace(/[^\w\u0600-\u06FF-]+/g, '-').slice(0, 48)}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        notify(t('sess.exported', 'Session exported'));
      } else if (res.path) {
        notify((useStore.getState().settings.language === 'ar' ? 'حُفظ التصدير في: ' : 'Export saved to: ') + res.path);
      } else {
        notify(res.error ?? t('misc.error', 'Error'));
      }
    } catch {
      notify(t('misc.error', 'Error'));
    }
  };

  // Export recap → agent-generated summary copied to the clipboard.
  // Defensive: surnia.agentRecap is a brand-new channel; a preload without it
  // degrades to a toast instead of throwing.
  const exportRecap = async (s: SessionMeta) => {
    try {
      const w = window as unknown as { surnia?: Record<string, unknown>; kodex?: Record<string, unknown> };
      const fn = (w.surnia ?? w.kodex)?.agentRecap;
      if (typeof fn !== 'function') {
        notify(t('sess.recap.unavailable', 'Recap bridge unavailable in this build'));
        return;
      }
      const res = (await (fn as (id: string) => Promise<unknown>)(s.id)) as
        | { recap?: string; text?: string; markdown?: string; error?: string }
        | string
        | null;
      const text =
        typeof res === 'string'
          ? res
          : res?.recap ?? res?.text ?? res?.markdown ?? (res && !res.error ? JSON.stringify(res) : '');
      if (!text) {
        notify(res && typeof res === 'object' && res.error ? res.error : t('sess.recap.failed', 'Could not build a recap'));
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        notify(t('sess.recap.copied', 'Recap copied to clipboard'));
      } catch {
        // clipboard denied — surface the text inline so nothing is lost
        notify(text.slice(0, 140));
      }
    } catch {
      notify(t('sess.recap.failed', 'Could not build a recap'));
    }
  };

  const row = (s: SessionMeta) => {
    const active = s.id === activeId;
    const renaming = s.id === renamingId;
    const empty = s.messageCount === 0;
    const isRunning = active && agentRunning;
    const st = sessionStamp(s, active, agentRunning, t);
    return (
      <div
        key={s.id}
        tabIndex={0}
        role="button"
        className={`keyrow group cursor-pointer row-focus focus:outline-none ${active ? 'bg-[color-mix(in_srgb,var(--acc)_7%,transparent)]' : ''} ${
          empty && !active ? 'opacity-60' : ''
        }`}
        onClick={() => {
          if (renaming) return;
          // announce the load so ChatPanel can show its shimmer skeleton
          window.dispatchEvent(new CustomEvent('surnia:session-loading'));
          void openSession(s.id).finally(() => window.dispatchEvent(new CustomEvent('surnia:session-loaded')));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !renaming) {
            window.dispatchEvent(new CustomEvent('surnia:session-loading'));
            void openSession(s.id).finally(() => window.dispatchEvent(new CustomEvent('surnia:session-loaded')));
          }
        }}
      >
        {renaming ? (
          <TextInput
            autoFocus
            dir="auto"
            className="!h-6 !text-[12px] !px-2"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') setRenamingId(null);
            }}
            onBlur={commitRename}
            onFocus={(e) => e.target.select()}
          />
        ) : (
          <>
            <span className="key-main min-w-0">
              {/* v2.6 RTL: dir=auto — Arabic titles read/truncate RTL, Latin LTR;
                  block display (chat.css v2.6) keeps title and meta on
                  separate lines so they can never jam together */}
              <span className="key-title truncate" dir="auto" title={s.title}>
                {s.title}
              </span>
              {/* v2.6 RTL: meta rebuilt from explicit segment spans on a flex row
                  (key-sub-flex, real gap). Pure technical Latin data — the row
                  stays LTR even in the Arabic UI, like the editor status line. */}
              <span className="key-sub key-sub-flex" dir="ltr">
                <span className="tnum shrink-0">
                  {s.messageCount} {t('sess.messages', 'msgs')}
                </span>
                <span aria-hidden="true">·</span>
                <span className="tnum shrink-0">
                  {s.totalTokens >= 1000 ? `${(s.totalTokens / 1000).toFixed(1)}k` : s.totalTokens}
                </span>
                {s.totalCostUsd > 0 ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tnum shrink-0">${s.totalCostUsd.toFixed(2)}</span>
                  </>
                ) : null}
                {s.model ? (
                  <span
                    className="font-code shrink-0 max-w-[16ch] truncate"
                    style={{
                      color: 'var(--acc2)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-pill)',
                      paddingInline: 6,
                      lineHeight: '15px',
                      fontSize: 9.5,
                    }}
                    dir="ltr"
                    title={s.model}
                  >
                    {shortModel(s.model)}
                  </span>
                ) : null}
                {s.workspace ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate min-w-0">{base(s.workspace)}</span>
                  </>
                ) : null}
              </span>
            </span>
            <span className={`stamp shrink-0 ${st.cls}`} title={st.title}>
              {st.label}
            </span>
            {/* v2.6 RTL: localized relative time ("الآن") in its own isolated span */}
            <span className="tnum text-[9.5px] text-faint shrink-0 hidden sm:inline" dir="auto" title={new Date(s.updatedAt).toLocaleString()}>
              {relTime(s.updatedAt, t)}
            </span>
            <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <IconBtn
                className="!w-5 !h-5"
                title={t('sess.fork', 'Fork session')}
                onClick={(e) => {
                  e.stopPropagation();
                  void forkSession(s.id);
                }}
              >
                <GitFork size={11} />
              </IconBtn>
              <IconBtn
                className="!w-5 !h-5"
                title={t('sess.export', 'Export as Markdown')}
                onClick={(e) => {
                  e.stopPropagation();
                  void exportSession(s);
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3.5v11M7.5 10 12 14.5 16.5 10M4.5 19.5h15" />
                </svg>
              </IconBtn>
              <IconBtn
                className="!w-5 !h-5"
                title={t('sess.recap', 'Export recap (copy to clipboard)')}
                onClick={(e) => {
                  e.stopPropagation();
                  void exportRecap(s);
                }}
              >
                <ScrollText size={11} />
              </IconBtn>
              <IconBtn
                className="!w-5 !h-5"
                title={t('sess.open', 'Open')}
                onClick={(e) => {
                  e.stopPropagation();
                  // same shimmer handshake as the row/Enter path
                  window.dispatchEvent(new CustomEvent('surnia:session-loading'));
                  void openSession(s.id).finally(() =>
                    window.dispatchEvent(new CustomEvent('surnia:session-loaded')),
                  );
                }}
              >
                <MessagesSquare size={11} />
              </IconBtn>
              <IconBtn
                className="!w-5 !h-5"
                title={t('ws.rename')}
                onClick={(e) => {
                  e.stopPropagation();
                  startRename(s.id, s.title);
                }}
              >
                <Pencil size={11} />
              </IconBtn>
              <IconBtn
                className="!w-5 !h-5"
                title={t('ws.delete')}
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(t('ws.confirmDelete'))) void deleteSession(s.id);
                }}
              >
                <Trash2 size={11} />
              </IconBtn>
            </span>
          </>
        )}
      </div>
    );
  };

  // ── A9 — one journal row (click → inline event timeline) ──
  const journalRow = (j: JournalSummary): React.ReactNode => {
    const st = outcomeStamp(j, t);
    const expanded = jExpanded === j.file;
    const d = new Date(j.at || 0);
    const task = j.task || t('jn.noTask', '(untitled run)');
    return (
      <React.Fragment key={j.file}>
        <div
          tabIndex={0}
          role="button"
          aria-expanded={expanded}
          className={`keyrow group cursor-pointer row-focus focus:outline-none ${expanded ? 'bg-[var(--hover)]' : ''}`}
          title={`${task} · ${d.toLocaleString()}`}
          onClick={() => toggleJournal(j.file)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') toggleJournal(j.file);
          }}
        >
          {/* status dot — warn (pulsing) for UNFINISHED, ok for finished runs */}
          <span
            aria-hidden="true"
            className={`w-[7px] h-[7px] rounded-full shrink-0 ${st.unfinished ? 'animate-pulse' : ''}`}
            style={{ background: st.unfinished ? 'var(--warn)' : 'var(--acc)' }}
          />
          <span className="key-main min-w-0">
            <span className="key-title truncate" dir="auto" title={task}>
              {truncTask(task)}
            </span>
            {/* date · time · event count — pure technical data, stays LTR */}
            <span className="key-sub key-sub-flex" dir="ltr">
              <span className="tnum shrink-0">{d.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
              <span aria-hidden="true">·</span>
              <span className="tnum shrink-0">
                {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
              </span>
              <span aria-hidden="true">·</span>
              <span className="tnum shrink-0">{t('jn.evCount', '{n} ev', { n: j.events })}</span>
            </span>
          </span>
          <span className={`stamp shrink-0 ${st.cls}`} title={st.title}>
            {st.label}
          </span>
          <span className="text-ghost shrink-0" aria-hidden="true">
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </span>
        </div>
        {expanded && (
          <div className="px-2.5 pb-2.5 border-t border-[var(--line-soft)]">
            {/* UNFINISHED: warn note — the run was killed or crashed */}
            {st.unfinished && (
              <div className="mt-2 mb-1.5 flex items-start gap-1.5 text-[10.5px] leading-snug text-[var(--warn)]">
                <span
                  aria-hidden="true"
                  className="mt-[4px] w-[7px] h-[7px] rounded-full shrink-0 animate-pulse"
                  style={{ background: 'var(--warn)' }}
                />
                <span>{t('jn.unfinishedNote', 'The run was killed or crashed — resume by starting a new session with the same task.')}</span>
              </div>
            )}
            <div className="flex items-baseline gap-2 px-1 pt-1.5 pb-1">
              <span className="caps text-[9.5px] text-ghost">{t('jn.timeline', 'Event timeline')}</span>
              {jEvents && jEvents.length > 0 ? (
                <span className="tnum text-[9.5px] text-ghost" dir="ltr">
                  {t('jn.shown', 'showing {a} of ~{b}', {
                    a: jEvents.length,
                    b: Math.max(j.events, jEvents.length),
                  })}
                </span>
              ) : null}
            </div>
            {/* compact monospace timeline — LTR (technical data), scrollable */}
            <div
              dir="ltr"
              role="list"
              aria-label={t('jn.timeline', 'Event timeline')}
              className="max-h-64 overflow-y-auto rounded-[6px] border border-line px-1.5 py-1"
              style={{ fontFamily: 'var(--font-mono2)', scrollbarWidth: 'thin', scrollbarColor: 'var(--line) transparent' }}
            >
              {jEvLoading && !jEvents ? (
                <div className="flex items-center gap-2 px-1 py-2 text-[11px] text-faint" dir="auto">
                  <Spinner size={12} />
                  {t('jn.loading', 'Loading events…')}
                </div>
              ) : !jEvents || jEvents.length === 0 ? (
                <div className="px-1 py-2 text-[11px] text-faint" dir="auto">
                  {t('jn.emptyEvents', 'No events recorded')}
                </div>
              ) : (
                jEvents.map((ev, i) => journalEventRow(ev, i, t))
              )}
            </div>
            {/* 'more' — grow the tail window by 100 (hidden once the file is drained) */}
            {jEvents && jEvents.length >= jLimit ? (
              <Btn
                variant="ghost"
                className="w-full mt-1.5 !h-7 !text-[11px]"
                disabled={jEvLoading}
                onClick={moreJournalEvents}
              >
                {jEvLoading ? <Spinner size={12} /> : null}
                {t('jn.more', 'Load 100 more')}
              </Btn>
            ) : null}
          </div>
        )}
      </React.Fragment>
    );
  };

  if (tab === 'schedule') {
    return <SchedulePanel embedded={embedded} />;
  }

  return (
    <div className={`p-2 hgs-page flex flex-col min-h-0 ${embedded ? 'flex-1' : 'h-full'}`}>
      {/* ---- editorial masthead ---- */}
      <div className="hgs-head">
        <PageHead
          eyebrow={lang === 'ar' ? '٠٤ / الجلسات' : '04 / SESSIONS'}
          title={t('sess.title', 'Sessions')}
          description={t('sess.desc', lang === 'ar'
            ? 'كل محادثة مؤرشفة وقابلة للاستئناف — مع خط زمني للنشاط الأخير.'
            : 'Every conversation, archived and resumable — with a timeline of recent activity.')}
          toolbar={<span className="hgs-glyph" aria-hidden><SessionsGlyph /></span>}
        />
      </div>

      {/* tab switcher — stamp-seg: sessions ↔ scheduled jobs (never an orphan feature) */}
      <div className="stamp-seg is-plain w-full shrink-0 mt-2 mb-2" role="tablist" aria-label={t('sess.title', 'Sessions')}>
        {(
          [
            { id: 'sessions' as const, label: t('sess.tabSessions', 'Sessions'), icon: <MessagesSquare size={11} /> },
            { id: 'schedule' as const, label: t('sess.tabSchedule', 'Scheduled'), icon: <CalendarClock size={11} /> },
          ]
        ).map(({ id, label, icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 cursor-pointer ${tab === id ? 'is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      <Btn variant="primary" className="w-full" onClick={() => void newSession()}>
        <Plus size={13} />
        {t('sess.new')}
      </Btn>

      <TextInput
        className="mt-2"
        placeholder={t('sess.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {/* dated session timeline — status glyphs on an aligned hairline axis */}
      <SessionTimeline sessions={sorted} activeId={activeId} agentRunning={agentRunning} lang={lang} />

      <div className="mt-2 flex-1 overflow-y-auto min-h-0">
        {!booted && sorted.length === 0 ? (
          <div className="p-1 flex flex-col gap-2 pt-3" aria-label={t('misc.loading', 'Loading…')}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="skel-row skeleton-shimmer" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="blank-state hero-grid aurora-panel">
            {/* v11.11 (A9-DESIGN) — the calm lantern instead of a bare chat icon */}
            <img
              src={emptySessions}
              alt=""
              aria-hidden
              width={160}
              height={110}
              className="ill-img"
              style={{ opacity: 0.92, borderRadius: 10 }}
            />
            <div className="bs-title">{t('sess.none', 'No sessions')}</div>
            <div className="bs-sub">{t('sess.noneHint', 'Start a run from the composer — every conversation is archived here.')}</div>
            {/* one real action — same wiring as the header button */}
            <Btn variant="primary" className="!h-7 !text-[11px]" onClick={() => void newSession()}>
              <Plus size={12} />
              {t('sess.new')}
            </Btn>
            <div className="bs-hint">
              <kbd className="kbd">{MOD_KEY}</kbd>
              <span>K</span>
              <span aria-hidden>·</span>
              <kbd className="kbd">{MOD_KEY}</kbd>
              <span>N</span>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-[11px] text-faint py-6">{t('ws.noResults')}</div>
        ) : (
          groups.map(({ id, items }) => (
            <div key={id} className="mb-1.5">
              <div className="flex items-baseline gap-2 px-1 pt-2 pb-1">
                <span className="tnum text-[9.5px] text-[var(--ghost)] font-semibold">{String(GROUP_ORDER.indexOf(id) + 1).padStart(2, '0')}</span>
                <span className="caps text-[10.5px] text-faint">{t(GROUP_LABEL[id].key, GROUP_LABEL[id].fb)}</span>
                <span className="tnum text-[9.5px] text-ghost">({items.length})</span>
                <span className="flex-1 h-px bg-[var(--line-soft)]" aria-hidden />
              </div>
              <div className="aurora-panel overflow-hidden">
                {items.map(row)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── A9 — RUN JOURNEYS: crash-resilient oversight of hours-long runs ──
          newest 10 journals · outcome stamp (completed / aborted / UNFINISHED)
          · click to expand the event timeline (40 first, +100 per 'more') */}
      <section className="shrink-0 mt-1" aria-label={t('jn.title', 'Run journals')}>
        <div className="flex items-baseline gap-2 px-1 pt-2 pb-1">
          <span className="tnum text-[9.5px] text-[var(--ghost)] font-semibold">05</span>
          <span className="caps text-[10.5px] text-faint">{t('jn.title', 'Run journals')}</span>
          <span className="tnum text-[9.5px] text-ghost">({journals.length})</span>
          <span className="flex-1 h-px bg-[var(--line-soft)]" aria-hidden />
          <IconBtn
            className="!w-5 !h-5"
            title={t('jn.refresh', 'Refresh journals')}
            aria-label={t('jn.refresh', 'Refresh journals')}
            onClick={() => void loadJournals()}
          >
            <RotateCw size={11} className={jLoading ? 'animate-spin' : ''} />
          </IconBtn>
        </div>
        <div className="aurora-panel max-h-[280px] overflow-y-auto">
          {jLoading && journals.length === 0 ? (
            <div className="p-1 flex flex-col gap-2 py-2" aria-label={t('misc.loading', 'Loading…')}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skel-row skeleton-shimmer" />
              ))}
            </div>
          ) : jFailed && journals.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-[var(--bad)]">{t('jn.failed', 'Could not read journals')}</div>
          ) : journals.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-3 py-3.5 text-center">
              <ScrollText size={16} className="text-[var(--faint)]" strokeWidth={1.5} aria-hidden />
              <div className="text-[11px] text-faint">{t('jn.none', 'No run journals yet')}</div>
            </div>
          ) : (
            journals.map(journalRow)
          )}
        </div>
      </section>
    </div>
  );
}

export default SessionsPanel;
