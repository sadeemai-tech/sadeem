// SubagentDetailModal — the "inside the agent" view. v11.36 turns it from a
// generic ledger summary into a TRUE child session (جلسة جوا الجلسة), like
// OpenCode: a parent-session breadcrumb that navigates back to the main chat,
// the agent's real delegated task, and a step-by-step timeline of REAL tool
// calls — each with name / input / status / output — streaming live.
//
// HONESTY CONTRACT: every transcript row comes from an engine event accumulated
// in `subagentToolCalls` (or from the persisted `record.toolCalls`). This view
// NEVER invents a tool name, argument, output or status. With no real calls it
// shows an honest empty state, never a fabricated demo feed.
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Copy, RotateCcw, X } from 'lucide-react';
import type { SubagentRecord, SubagentStatus, SubagentToolCall } from '../../shared/types';
import { useStore } from '../store';
import { useT, useDigits } from '../i18n';
import { api } from '../lib/api';
import { agentVisual, dotOf, durationOf, pctOf } from '../lib/subagentDisplay';
import './subagents.css';
import './agentSession.css';

interface Step {
  at: number;
  done: number;
  total: number;
  /**
   * The engine DOES emit a real short action label (`subagent_progress.step`,
   * electron/agent/subagents.ts:61), but shared/types.ts:432 and store.ts:4760
   * drop it today. Keeping it optional here means the moment the parent wires
   * the field through, this view shows the REAL action — no invented feed.
   */
  step?: string;
}

/** Stable empty arrays — returning a fresh [] from a zustand v5 selector can
 *  retrigger the snapshot equality check on every render. */
const EMPTY_STEPS: Step[] = [];
const EMPTY_TOOL_CALLS: SubagentToolCall[] = [];

interface TimelineEntry {
  at: number;
  text: string;
  kind: 'start' | 'step' | 'end' | 'warn';
}

function timeOf(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function statusLabel(status: SubagentStatus, t: (k: string, fb?: string) => string): string {
  if (status === 'running') return t('sa.running', 'RUNNING');
  if (status === 'error') return t('sa.error.st', 'ERROR');
  if (status === 'aborted') return t('sa.aborted.st', 'ABORTED');
  return t('sa.done', 'DONE');
}

/** Real per-call status → bilingual single-language label (existing keys). */
function callStatusLabel(status: SubagentToolCall['status'], t: (k: string, fb?: string) => string): string {
  if (status === 'running') return t('tool.status.running', 'Running');
  if (status === 'error') return t('tool.status.error', 'Error');
  return t('tool.status.ok', 'Done');
}

export function SubagentDetailModal() {
  const t = useT();
  const n = useDigits();
  const id = useStore((s) => s.subagentDetailId);
  const close = useStore((s) => s.closeSubagentDetail);
  const openSession = useStore((s) => s.openSession);
  const retrySubagent = useStore((s) => s.retrySubagent);
  const inStore = useStore((s) => s.subagents.find((r) => r.id === id));
  const steps = useStore((s) => (id ? s.subagentSteps[id] ?? EMPTY_STEPS : EMPTY_STEPS));
  // v11.36 — the LIVE transcript. Accumulated from real engine events; the
  // persisted record is only a fallback for a freshly-fetched / restored row.
  const liveToolCalls = useStore((s) => (id ? s.subagentToolCalls[id] : undefined));
  const [fetched, setFetched] = useState<SubagentRecord | null>(null);
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const record = inStore ?? fetched;
  const toolCalls: SubagentToolCall[] =
    liveToolCalls ?? record?.toolCalls ?? fetched?.toolCalls ?? EMPTY_TOOL_CALLS;

  // A freshly-launched subagent may not be in the store yet — fetch by id
  // (the IPC already exists) and let the live push events take over.
  useEffect(() => {
    setFetched(null);
    setCopied(false);
    if (!id || inStore) return;
    let alive = true;
    void api
      .subagentsGet?.(id)
      .then((r) => {
        if (alive) setFetched(r ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, inStore]);

  // Escape closes; the backdrop click below closes too.
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [id, close]);

  const visual = useMemo(() => agentVisual(record?.role), [record?.role]);
  const Icon = visual.icon;
  const dot = dotOf(record?.status);

  const timeline = useMemo<TimelineEntry[]>(() => {
    if (!record) return [];
    const list: TimelineEntry[] = [
      { at: record.startedAt, text: t('sad.launched', 'Delegated to {role}', { role: visual.name }), kind: 'start' },
    ];
    const seen = new Set<number>();
    for (const s of steps as Step[]) {
      if (seen.has(s.done)) continue; // dedupe repeated progress at the same step
      seen.add(s.done);
      const base = t('sad.step', 'Step {n} of {total}', { n: s.done, total: s.total });
      list.push({
        at: s.at || record.startedAt,
        // Prefer the REAL action label when the IPC keeps it; never fabricate one.
        text: s.step ? `${base} · ${s.step}` : base,
        kind: 'step',
      });
    }
    if (record.endedAt) {
      const failed = record.status === 'error' || record.status === 'aborted';
      list.push({
        at: record.endedAt,
        text: failed
          ? record.error || t('sad.failed', 'Subagent failed')
          : t('sad.finished', 'Finished · {n} steps', { n: steps.length ? steps[steps.length - 1].done : record.total }),
        kind: failed ? 'warn' : 'end',
      });
    }
    return list.sort((a, b) => a.at - b.at);
  }, [record, steps, t, visual.name]);

  if (!id) return null;

  const copyPrompt = () => {
    // v11.31 — the Copy button must never be dead just because a legacy ledger
    // row has no `prompt`; the description is the same delegated task text.
    const text = record?.prompt || record?.description || '';
    if (!text) return;
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    };
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text).then(done).catch(() => undefined);
      } else done();
    } catch {
      done();
    }
  };

  /**
   * v11.36 (G3) — the parent breadcrumb is a REAL navigation, not a modal
   * dismissal: it enters the main session (`openSession(record.sessionId)`)
   * that owns this child, exactly like navigating to a parent session.
   */
  const openParentSession = () => {
    if (record?.sessionId) void openSession(record.sessionId);
    close();
  };

  const onRetry = () => {
    if (!record || retrying) return;
    setRetrying(true);
    try {
      void Promise.resolve(retrySubagent?.(record.id))
        .catch(() => undefined)
        .finally(() => {
          setRetrying(false);
          close();
        });
    } catch {
      setRetrying(false);
      close();
    }
  };

  const pct = record ? pctOf(record.done, record.total, record.status) : 0;
  // The orbital rail below is drawn ONLY from real progress events. No tool
  // names, args or outputs are invented: the engine exposes counters
  // ({at, done, total}) per subagent, never a per-agent tool-call transcript.
  const lastStep = steps.length ? (steps as Step[])[steps.length - 1] : undefined;
  const railAt = lastStep && lastStep.total > 0
    ? Math.max(0, Math.min(100, Math.round((lastStep.done / lastStep.total) * 100)))
    : 0;

  return (
    <div className="sad-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="sad-modal" role="dialog" aria-modal="true" aria-label={t('sad.title', 'Subagent detail')} data-testid="sad-modal">
        {/* ---------- header ---------- */}
        <header className="sad-head">
          {/* v11.35 — "a way back": a real, labelled control that returns to
              the parent team view (same action as Escape / backdrop). */}
          <button
            type="button"
            className="sad-back press"
            data-testid="sad-back"
            onClick={close}
            title={t('sa.team', 'AGENT TEAM')}
            aria-label={t('sa.team', 'AGENT TEAM')}
          >
            <ChevronRight size={13} strokeWidth={2} className="sad-back-arrow" aria-hidden />
            <span>{t('sa.team', 'AGENT TEAM')}</span>
          </button>
          <span className="sad-avatar" style={{ '--chip-tone': visual.tone } as React.CSSProperties} aria-hidden>
            <Icon size={17} strokeWidth={1.7} />
            <span className={`sad-dot is-${dot}`} aria-hidden>
              {dot === 'done' ? <Check size={8} strokeWidth={2.6} /> : dot === 'warn' ? <AlertTriangle size={8} strokeWidth={2.4} /> : null}
            </span>
          </span>
          <div className="sad-head-copy min-w-0">
            <div className="sad-eyebrow" dir="ltr">{t('sad.eyebrow', 'SUBAGENT / DETAIL')}</div>
            <h2 className="sad-title truncate" dir="auto">{record ? visual.name : t('sad.loading', 'Loading…')}</h2>
            <div className="sad-roleline">
              <span className="sa-role" dir="ltr">{record?.role ?? '—'}</span>
              {record?.background && <span className="sad-tag" dir="ltr">BG</span>}
              {!!record?.attempt && <span className="sad-tag" dir="ltr">↻{record.attempt}</span>}
            </div>
          </div>
          <button className="sad-close" onClick={close} title={t('common.close', 'Close')} aria-label={t('common.close', 'Close')}>
            <X size={15} />
          </button>
        </header>

        {/* ---------- v11.36 parent breadcrumb — "back to main session" --------
            Unlike `sad-back` (which only dismisses the modal), this crumb
            NAVIGATES to the real parent session that launched this child. */}
        <nav className="sad-breadcrumb" aria-label={t('sad.parentSession', 'MAIN SESSION')} data-testid="sad-breadcrumb">
          <button type="button" className="sad-crumb press" onClick={openParentSession}>
            <span className="sad-crumb-label">{t('sad.parentSession', 'MAIN SESSION')}</span>
            <ChevronRight size={11} className="sad-crumb-arrow" aria-hidden />
            <span className="sad-crumb-id tnum" dir="ltr" title={record?.sessionId}>
              {record?.sessionId ? String(record.sessionId).slice(0, 12) : '—'}
            </span>
          </button>
          <span className="sad-crumb-hint">{t('sad.childSession', 'CHILD SESSION')}</span>
        </nav>

        {!record ? (
          <div className="sad-empty">{t('sad.notFound', 'This subagent is no longer in the ledger.')}</div>
        ) : (
          <div className="sad-scroll">
            {/* ---------- orbital step rail (real progress counters only) ----------
                One hairline, one tick per recorded step and a breathing head at
                the real done/total position while the agent is running. The
                authoritative, time-stamped list is the timeline below — this
                is its orbital silhouette, never a substitute transcript. */}
            {steps.length > 0 && (
              <div className="sad-orbit-rail" aria-hidden>
                <span className="sad-orbit-line" />
                {(steps as Step[]).map((s, i) => (
                  <span
                    key={`${s.at}-${i}`}
                    className="sad-orbit-tick"
                    style={{ '--i': i, '--n': steps.length } as React.CSSProperties}
                  />
                ))}
                {record.status === 'running' && (
                  <span className="sad-orbit-head" style={{ insetInlineStart: `${railAt}%` }} />
                )}
              </div>
            )}

            {/* ---------- status strip ---------- */}
            <div className="sad-strip">
              <span className={`sad-status is-${record.status}`}>{statusLabel(record.status, t)}</span>
              <span className="sad-stat"><b>{durationOf(record.durationMs ?? (record.endedAt ? record.endedAt - record.startedAt : undefined))}</b><small>{t('sad.duration', 'DURATION')}</small></span>
              <span className="sad-stat"><b>{n(record.done)}/{n(record.total)}</b><small>{t('sad.steps', 'STEPS')}</small></span>
              <span className="sad-stat"><b>{n(pct)}%</b><small>{t('sad.progress', 'PROGRESS')}</small></span>
            </div>
            <div className="agt-track sad-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="agt-fill" style={{ width: `${pct}%` }} />
            </div>

            {/* ---------- prompt (the REAL delegated task) ---------- */}
            <section className="sad-section">
              <div className="sad-section-head">
                <h3>{t('sad.prompt', 'Prompt')}</h3>
                <button className="sad-copy" onClick={copyPrompt} title={copied ? t('chat.copied', 'Copied') : t('tool.copyArgs', 'Copy')}>
                  {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
                  <span>{copied ? t('chat.copied', 'Copied') : t('chat.copy', 'Copy')}</span>
                </button>
              </div>
              {record.description && record.description !== record.label && (
                <div className="sad-desc" dir="auto">{record.description}</div>
              )}
              <pre className="sad-prompt" data-testid="sad-prompt" dir="auto">{record.prompt || t('sad.noPrompt', '(no prompt recorded)')}</pre>
            </section>

            {/* ---------- v11.36 REAL TOOL-CALL TRANSCRIPT (session-in-session) ---
                This is the founder's "جلسة جوا الجلسة": one row per REAL tool
                call the child agent made, with name / input / status / output,
                streamed as the engine emits them. No placeholder rows. */}
            <section className="sad-section jc-section">
              <div className="sad-section-head">
                <h3>{t('sad.toolCalls', 'TOOL CALLS')}</h3>
                <span className="sad-hint">{n(toolCalls.length)} {t('sad.events', 'events')}</span>
              </div>
              <ol className="jc-timeline" data-testid="sad-toolcalls">
                {toolCalls
                  .map((tc, i) => (
                  <li
                    key={`${tc.toolCallId ?? tc.name}-${tc.at}-${i}`}
                    className={`jc-row is-${tc.status}`}
                    data-testid="sad-toolcall"
                    data-status={tc.status}
                  >
                    <span className="jc-seq tnum" dir="ltr">{String(i + 1).padStart(2, '0')}</span>
                    <div className="jc-body">
                      <div className="jc-head">
                        <b className="jc-name" dir="auto">{tc.name}</b>
                        <span className={`jc-status is-${tc.status}`}>{callStatusLabel(tc.status, t)}</span>
                        <span className="jc-time tnum" dir="ltr">{timeOf(tc.at)}</span>
                      </div>
                      {tc.input && (
                        <div className="jc-field">
                          <span className="jc-k" dir="ltr">{t('tool.args', 'Arguments')}</span>
                          <pre className="jc-v" dir="auto">{tc.input}</pre>
                        </div>
                      )}
                      {tc.output && (
                        <div className="jc-field">
                          <span className="jc-k" dir="ltr">{t('tool.result', 'Result')}</span>
                          <pre className="jc-v" dir="auto">{tc.output}</pre>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {!toolCalls.length && (
                <div className="jc-empty">
                  {record.status === 'running'
                    ? t('sad.waiting', 'Waiting for the next step…')
                    : t('sad.noToolCalls', '(no tool calls recorded)')}
                </div>
              )}
            </section>

            {/* ---------- live timeline (progress counters, never a substitute) ---------- */}
            <section className="sad-section">
              <div className="sad-section-head">
                <h3>{t('sad.timeline', 'Timeline')}</h3>
                <span className="sad-hint">{n(timeline.length)} {t('sad.events', 'events')}</span>
              </div>
              <ol className="sad-timeline" data-testid="sad-timeline">
                {timeline.map((ev, i) => (
                  <li key={`${ev.at}-${i}`} className={`sad-event is-${ev.kind}`}>
                    <span className="sad-event-dot" aria-hidden />
                    <span className="sad-event-time tnum" dir="ltr">{timeOf(ev.at)}</span>
                    <span className="sad-event-text" dir="auto">{ev.text}</span>
                  </li>
                ))}
                {record.status === 'running' && (
                  <li className="sad-event is-live">
                    <span className="sad-event-dot" aria-hidden />
                    <span className="sad-event-time tnum" dir="ltr">—</span>
                    <span className="sad-event-text">{t('sad.waiting', 'Waiting for the next step…')}</span>
                  </li>
                )}
              </ol>
            </section>

            {/* ---------- output ---------- */}
            <section className="sad-section">
              <div className="sad-section-head"><h3>{t('sad.output', 'Output')}</h3></div>
              {record.status === 'error' || record.status === 'aborted' ? (
                <pre className="sad-output is-bad" data-testid="sad-output" dir="auto">{record.error || t('sad.noOutput', '(no output)')}</pre>
              ) : (
                <pre className="sad-output" data-testid="sad-output" dir="auto">{record.summary || t('sad.pending', '(still running — output arrives on completion)')}</pre>
              )}
            </section>
          </div>
        )}

        {/* ---------- footer ---------- */}
        <footer className="sad-foot">
          <span className="sad-id tnum" dir="ltr" title={id}>#{String(id).slice(0, 8)}</span>
          <button
            className="sad-retry press"
            disabled={!record || retrying}
            aria-busy={retrying}
            data-testid="sad-retry"
            onClick={onRetry}
            title={t('sa.retry', 'Re-run the same subagent prompt')}
          >
            <RotateCcw size={12} />
            <span>{retrying ? t('sa.retrying', 'Re-running…') : t('sa.retry', 'Retry')}</span>
            <ChevronRight size={11} className="sad-retry-arrow" />
          </button>
        </footer>
      </section>
    </div>
  );
}

export default SubagentDetailModal;
