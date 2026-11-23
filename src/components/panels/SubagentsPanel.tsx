// SubagentsPanel — Rail view 15 (v11.12) · LIVE subagent dashboard.
// Shows every subagent launched through the `task` tool (foreground and
// background) with id, role, status, a real-time progress bar, duration, the
// original prompt and a "Retry failed" action that re-runs the SAME prompt in
// a detached loop. Records arrive live over `kdx:subagents:event` and land in
// the store's `subagents` slice; the panel just renders that slice.
//
// v11.12 FINAL POLISH — the ORBITAL TEAM PLATE. Five nodes exactly 72° apart,
// each with a status glyph, a real stroke-dasharray progress arc and a leader
// line to a mono label. Node clicks still call openSubagentDetail. All
// behaviour, IPC, state and store hooks are untouched — presentation only.
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import type { SubagentRecord, SubagentStatus } from '../../../shared/types';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { Btn } from '../ui';
import '../pages.css';
import '../sections.css';
import './subagents-art.css';
import './panel-craft.css';

type Filter = 'all' | 'running' | 'done' | 'error';

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
    return `قبل ${dd}ي`;
  }
  if (m < 1) return 'now';
  if (h < 1) return `${m}m ago`;
  if (dd < 1) return `${h}h ago`;
  return `${dd}d ago`;
}

function duration(ms?: number): string {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 8) : id;
}

function pctOf(row: SubagentRecord): number {
  return row.total > 0 ? Math.min(100, Math.round((row.done / row.total) * 100)) : row.status === 'done' ? 100 : 0;
}

const STATUS_KEY: Record<SubagentStatus, string> = {
  running: 'sa.running.st',
  done: 'sa.done.st',
  error: 'sa.error.st',
  aborted: 'sa.aborted.st',
};
const STATUS_FB: Record<SubagentStatus, string> = {
  running: 'RUNNING',
  done: 'DONE',
  error: 'ERROR',
  aborted: 'ABORTED',
};

/* ------------------------------------------------------------------ *
 * ORIGINAL 1px GLYPH — three specialists orbiting one centre, drawn
 * as open hairlines and registration dots (never an icon pack).
 * ------------------------------------------------------------------ */
function SubagentsGlyph() {
  return (
    <svg className="ed-glyph" viewBox="0 0 72 34" fill="none" stroke="currentColor"
      strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="36" cy="17" r="4" />
      <path d="M36 13V5M32.5 19 23 27M39.5 19 49 27" />
      <circle cx="36" cy="4" r="2" />
      <circle cx="22" cy="28" r="2" />
      <circle cx="50" cy="28" r="2" />
      <path d="M8 17h9M55 17h9" opacity=".5" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * THE ORBITAL TEAM PLATE — the user's most-emphasised visual.
 * Geometry is exact: 360° / 5 = 72°, starting at 12 o'clock. Each
 * node carries (1) a status glyph, (2) a progress arc whose dash
 * length is the REAL done/total value, and (3) a leader line ending
 * in a mono role label. The complete node group is a button that
 * opens the same subagent detail as the list card.
 * ------------------------------------------------------------------ */
const PLATE_NODES = 5;
const PLATE_STEP = 360 / PLATE_NODES; // 72°
const CX = 230;
const CY = 190;
const NODE_R = 120;
const RING_R = 19;

function statusColor(status: SubagentStatus | undefined): string {
  if (!status) return 'var(--faint)';
  if (status === 'running') return 'var(--agent)';
  if (status === 'done') return 'var(--ok)';
  return 'var(--bad)'; // error + aborted
}

function OrbitalPlate({ rows, total, t, lang, onOpen }: {
  rows: SubagentRecord[];
  /** Total in the active filter — the plate only draws the first five. */
  total: number;
  t: (k: string, fb?: string) => string;
  lang: string;
  onOpen: (id: string) => void;
}) {
  const spokes = Array.from({ length: PLATE_NODES }, (_, i) => {
    const a = ((i * PLATE_STEP - 90) * Math.PI) / 180;
    const nx = CX + Math.cos(a) * NODE_R;
    const ny = CY + Math.sin(a) * NODE_R;
    const row = rows[i];
    const status = row?.status;
    const pct = row ? pctOf(row) : 0;
    const color = statusColor(status);

    // leader line: radial out from the ring, then a short horizontal run
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const lx = nx + ux * 34;
    const ly = ny + uy * 34;
    const dir = ux < -0.01 ? -1 : 1;
    const endX = lx + dir * 15;
    const textX = endX + dir * 4;
    const anchor = dir < 0 ? 'end' : 'start';
    const role = row ? row.role.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 10) : 'VACANT';
    const labelStatus = row ? t(STATUS_KEY[status!], STATUS_FB[status!]) : '—';

    return (
      <g key={i}>
        {/* centre spoke */}
        <line className="sa-spoke" x1={CX} y1={CY} x2={nx} y2={ny} />
        <g
          className={`sa-node${row ? ` is-${status}` : ' is-vacant'}`}
          role={row ? 'button' : undefined}
          tabIndex={row ? 0 : undefined}
          aria-label={row ? `${row.role} — ${labelStatus} — ${pct}%` : undefined}
          onClick={row ? () => onOpen(row.id) : undefined}
          onKeyDown={row ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(row.id); } } : undefined}
        >
          {/* generous transparent hit area — keeps the whole node clickable */}
          <circle className="sa-hit" cx={nx} cy={ny} r="28" fill="transparent" />
          {/* progress track + real progress arc */}
          <circle className="sa-track" cx={nx} cy={ny} r={RING_R} fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
          {row && (
            <circle
              className="sa-arc"
              cx={nx} cy={ny} r={RING_R} fill="none"
              stroke={color} strokeWidth="2" strokeLinecap="round"
              pathLength={1}
              strokeDasharray={`${pct / 100} 1`}
              transform={`rotate(-90 ${nx} ${ny})`}
            />
          )}
          {/* status glyph */}
          {!row && (
            <circle cx={nx} cy={ny} r="7" fill="none" stroke="var(--faint)" strokeWidth="1" strokeDasharray="2 3" opacity=".55" />
          )}
          {status === 'running' && (
            <g>
              <circle className="sa-breathe" cx={nx} cy={ny} r="8" fill="none" stroke={color} strokeWidth="1" />
              <circle cx={nx} cy={ny} r="3.6" fill={color} stroke="none" />
            </g>
          )}
          {status === 'done' && (
            <g>
              <circle cx={nx} cy={ny} r="8" fill={color} opacity=".12" stroke="none" />
              <path d={`M${nx - 3.4} ${ny}l2.4 2.6 4.8-5.4`} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )}
          {(status === 'error' || status === 'aborted') && (
            <g>
              <circle cx={nx} cy={ny} r="8" fill={color} opacity=".12" stroke="none" />
              <path d={`M${nx - 3} ${ny - 3}l6 6M${nx + 3} ${ny - 3}l-6 6`} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
            </g>
          )}
          {/* leader line + mono label */}
          <path className="sa-leader" d={`M${nx + ux * 23} ${ny + uy * 23}L${lx} ${ly}L${endX} ${ly}`} fill="none" stroke="var(--line-strong)" strokeWidth="1" />
          <circle cx={lx} cy={ly} r="1.5" fill={row ? color : 'var(--faint)'} stroke="none" />
          <text className="sa-node-role" x={textX} y={ly - 2} textAnchor={anchor}>{role}</text>
          <text className="sa-node-sub" x={textX} y={ly + 10} textAnchor={anchor}>{row ? `${pct}%` : labelStatus}</text>
        </g>
      </g>
    );
  });

  return (
    <figure className="sa-plate">
      <div className="sa-plate-head">
        <span className="ed-mono">{t('sa.team', lang === 'ar' ? 'فريق الوكلاء' : 'AGENT TEAM')}</span>
        <span
          className="ed-mono sa-plate-count"
          dir="ltr"
          title={t('sa.plate.countTip', lang === 'ar' ? 'أول خمسة وكلاء من إجمالي الوكلاء المطابقين' : 'first five shown of all matching subagents')}
        >
          {rows.length} / {total}
        </span>
      </div>
      <svg viewBox="0 0 460 380" preserveAspectRatio="xMidYMid meet" role="img"
        aria-label={t('sa.plate.a11y', lang === 'ar' ? 'لوحة الفريق المدارية' : 'Orbital team plate')}>
        <g className="sa-orbit" fill="none" stroke="currentColor">
          <circle cx={CX} cy={CY} r="168" strokeWidth=".7" strokeDasharray="1 9" opacity=".5" />
          <circle className="sa-orbit-dot" cx={CX} cy={CY - 168} r="2.6" fill="var(--acc)" stroke="none" />
        </g>
        {/* 36 graduations = exactly 10° apart; every 3rd is a 30° major.
            Each hairline draws itself on mount in repeating 60ms steps. */}
        <g className="sa-grad" fill="none" stroke="currentColor" strokeWidth=".6" opacity=".35">
          {Array.from({ length: 36 }, (_, i) => {
            const a = (i / 36) * Math.PI * 2;
            const major = i % 3 === 0;
            const r1 = major ? 174 : 177;
            const r2 = 182;
            return <line key={i} className="craft-draw" pathLength={1}
              style={{ animationDelay: `${(i % 6) * 60}ms` }}
              x1={CX + Math.cos(a) * r1} y1={CY + Math.sin(a) * r1}
              x2={CX + Math.cos(a) * r2} y2={CY + Math.sin(a) * r2} />;
          })}
        </g>
        <circle className="sa-inner-ring craft-draw" pathLength={1} cx={CX} cy={CY} r="44"
          fill="none" stroke="var(--line)" strokeWidth="1" style={{ animationDelay: '60ms' }} />
        <circle cx={CX} cy={CY} r="2" fill="var(--acc)" stroke="none" />
        <text className="sa-hub" x={CX} y={CY + 24} textAnchor="middle">LEAD</text>
        {spokes}
      </svg>
      <figcaption className="ed-mono sa-plate-cap">
        {t('sa.plate.hint', lang === 'ar' ? 'كل عقدة تفتح تفاصيل الوكيل · الأقواس من التقدم الحقيقي' : 'each node opens a detail · arcs use real progress')}
      </figcaption>
    </figure>
  );
}

export function SubagentsPanel() {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const rows = useStore((s) => s.subagents);
  const loading = useStore((s) => s.subagentsLoading);
  const loadSubagents = useStore((s) => s.loadSubagents);
  const retrySubagent = useStore((s) => s.retrySubagent);
  const clearSubagents = useStore((s) => s.clearSubagents);
  const openSubagentDetail = useStore((s) => s.openSubagentDetail);
  const notify = useStore((s) => s.notify);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void loadSubagents();
  }, [loadSubagents]);

  const counts = useMemo(() => {
    let running = 0;
    let done = 0;
    let error = 0;
    for (const r of rows) {
      if (r.status === 'running') running++;
      else if (r.status === 'done') done++;
      else error++; // error + aborted
    }
    return { total: rows.length, running, done, error };
  }, [rows]);

  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => (filter === 'error' ? r.status === 'error' || r.status === 'aborted' : r.status === filter))),
    [rows, filter],
  );

  const clearHistory = async (): Promise<void> => {
    await clearSubagents();
    notify(t('sa.cleared', 'Subagent history cleared'));
  };

  const retry = async (id: string): Promise<void> => {
    setRetrying((prev) => ({ ...prev, [id]: true }));
    try {
      // The store reports success/failure via its own toast; here we only
      // own the honest per-row busy state so the button can't be double-fired.
      await retrySubagent(id);
    } finally {
      setRetrying((prev) => ({ ...prev, [id]: false }));
    }
  };

  return (
    <div className="sa-art page-v14">
      {/* ---------- editorial head ---------- */}
      <header className="ed-head">
        <div className="ed-head-main">
          <div className="ed-head-top">
            <span className="ed-eyebrow" dir="ltr">06 / SUBAGENTS</span>
            <SubagentsGlyph />
          </div>
          <h2 className="ed-head-title" dir="auto">{t('sa.title', 'Subagents')}</h2>
          <p className="ed-head-desc" dir="auto">{t('sa.desc', 'Every specialist launched by the agent — live progress, outcomes and one-click retry.')}</p>
        </div>
        <div className="ed-head-actions">
          <Btn className="!h-7 !px-2.5 !text-[11px]" title={t('sa.refresh', 'Refresh')} onClick={() => void loadSubagents()}>
            <RefreshCw size={13} />
          </Btn>
          <Btn
            variant="danger"
            className="!h-7 !px-2.5 !text-[11px]"
            title={t('sa.clear', 'Clear history')}
            onClick={() => void clearHistory()}
            disabled={!rows.length}
          >
            <Trash2 size={13} />
          </Btn>
        </div>
      </header>

      {/* ---------- stat tiles ---------- */}
      <div className="sa-stats">
        <Stat label={t('sa.total', 'TOTAL')} value={counts.total} />
        <Stat label={t('sa.running', 'RUNNING')} value={counts.running} tone="var(--agent)" />
        <Stat label={t('sa.done', 'DONE')} value={counts.done} tone="var(--ok)" />
        <div title={t('sa.failedTip', 'Errors + aborted subagents')}>
          <Stat label={t('sa.failed', 'FAILED')} value={counts.error} tone="var(--bad)" />
        </div>
      </div>

      {/* ---------- the orbital team plate ---------- */}
      <OrbitalPlate
        rows={visible.slice(0, PLATE_NODES)}
        total={visible.length}
        t={t}
        lang={lang}
        onOpen={openSubagentDetail}
      />

      {/* ---------- filters ---------- */}
      <div className="sa-toolbar">
        {(['all', 'running', 'done', 'error'] as Filter[]).map((f) => (
          <button
            key={f}
            className={`ed-mono sa-filter ${filter === f ? 'is-active' : ''}`}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
          >
            {t(`sa.filter.${f}`, f.toUpperCase())}
          </button>
        ))}
        <span className="sa-count ed-mono" dir="ltr">{visible.length} / {rows.length}</span>
      </div>

      {/* ---------- live list ---------- */}
      {loading && !rows.length ? (
        <div className="ed-muted ed-body sa-loading">{t('sa.loading', 'Loading subagents…')}</div>
      ) : visible.length === 0 ? (
        <div className="sa-empty">
          <div className="sa-title-lg">{t('sa.emptyTitle', 'No subagents yet')}</div>
          <div className="ed-body ed-muted" dir="auto">
            {t('sa.emptySub', 'When the agent delegates a task (the `task` tool), its live progress appears here.')}
          </div>
        </div>
      ) : (
        <div className="sa-list">
          {visible.map((r, idx) => (
            <SubagentCard
              key={r.id}
              row={r}
              lang={lang}
              t={t}
              index={idx}
              expanded={expanded === r.id}
              onToggle={() => setExpanded((cur) => (cur === r.id ? null : r.id))}
              onRetry={() => void retry(r.id)}
              retrying={!!retrying[r.id]}
              onOpenDetail={() => openSubagentDetail(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="sa-stat">
      <span className="ed-mono sa-stat-label">{label}</span>
      <span className="sa-stat-value" style={tone ? { color: tone } : undefined} dir="ltr">
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function SubagentCard({
  row,
  lang,
  t,
  index,
  expanded,
  retrying,
  onToggle,
  onRetry,
  onOpenDetail,
}: {
  row: SubagentRecord;
  lang: string;
  t: (k: string, fb?: string) => string;
  index: number;
  expanded: boolean;
  retrying: boolean;
  onToggle: () => void;
  onRetry: () => void;
  onOpenDetail: () => void;
}) {
  const pct = pctOf(row);
  const isFailed = row.status === 'error' || row.status === 'aborted';
  return (
    <article className={`sa-card ${row.status}`} style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}>
      <div className="sa-card-head">
        <span className="ed-mono sa-card-num" dir="ltr">{String(index + 1).padStart(2, '0')}</span>
        <div className="min-w-0 flex-1">
          <div className="sa-title" dir="auto" title={row.label}>{row.label}</div>
          <div className="ed-mono sa-role" dir="auto">{row.role}</div>
        </div>
        <span className={`stamp ${row.status === 'done' ? 'stamp-acc' : isFailed ? 'stamp-bad' : 'stamp-warn'}`}>
          {t(STATUS_KEY[row.status], STATUS_FB[row.status])}
        </span>
      </div>

      {row.description && row.description !== row.label && (
        <div className="sa-desc" title={row.description} dir="auto">{row.description}</div>
      )}

      <div className="sa-track" title={`${row.done}/${row.total}`} role="progressbar"
        aria-valuemin={0} aria-valuemax={row.total || 100} aria-valuenow={row.done}>
        <div className="sa-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="ed-mono sa-meta" dir="ltr">
        <span title={row.id}>#{shortId(row.id)}</span>
        <span>{row.done}/{row.total} · {pct}%</span>
        <span>{duration(row.durationMs ?? (row.endedAt ? row.endedAt - row.startedAt : undefined))}</span>
        <span>{relTime(row.startedAt, lang)}</span>
        {row.background && <span title="background subagent">BG</span>}
        {row.attempt > 0 && <span title="retry count">↻{row.attempt}</span>}
      </div>

      {row.status === 'done' && row.summary && <div className="sa-summary" dir="auto">{row.summary}</div>}
      {isFailed && row.error && <div className="sa-summary sa-error" dir="auto">{row.error}</div>}

      <div className="sa-actions">
        <button className="sa-link" onClick={onToggle} aria-expanded={expanded}>
          <ChevronDown size={12} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
          {t('sa.prompt', 'Prompt')}
        </button>
        <button className="sa-link" onClick={onOpenDetail} title={t('sad.title', 'Subagent detail')}>
          <ExternalLink size={12} />
          {t('sa.openDetail', 'Open')}
        </button>
        {isFailed && (
          <Btn
            variant="primary"
            className="!h-6 !px-2 !text-[10px] sa-retry"
            onClick={onRetry}
            disabled={retrying}
            title={t('sa.retry', 'Re-run the same subagent prompt')}
          >
            {retrying ? <RefreshCw size={11} className="spin" /> : <RotateCcw size={11} />}
            {retrying ? t('sa.retrying', 'Retrying…') : t('sa.retry', 'Retry')}
          </Btn>
        )}
      </div>
      {expanded && <div className="sa-summary sa-prompt" dir="auto">{row.prompt || t('sad.noPrompt', '(no prompt recorded)')}</div>}
    </article>
  );
}

export default SubagentsPanel;
