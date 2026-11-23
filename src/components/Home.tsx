// SADEEM — HOME (v10). The first rail view: a real overview, not a mock.
// Every number on this page comes from the live store — sessions, running
// goal, subagent progress, git status, MCP servers, scheduled jobs, the
// published False-Done honesty metric, model + permission posture and the
// recent-projects list. Actions call the exact store actions the rest of
// the app uses (newSession / openSession / openFolderDialog / openWorkspace
// / setRail / setScheduledOpen / setSettings). No fake data anywhere.
import React, { useMemo } from 'react';
import {
  Activity,
  ChevronRight,
  Clock,
  FolderOpen,
  GitBranch,
  ListChecks,
  MessageSquarePlus,
  Plug,
  Plus,
  ShieldCheck,
  Timer,
  TriangleAlert,
} from 'lucide-react';
import { useStore, PROVIDER_PRESETS } from '../store';
import { useT } from '../i18n';
import { APP_VERSION } from '../version';
// v11.11 (A9) — hand-authored empty-state illustration (license-clean SVG)
import emptySessions from '../assets/illustrations/empty-sessions.svg';
import './pages.css';
// FINAL LAUNCH POLISH — editorial art layer (loaded last so it wins ties).
import './panels/hgs-art.css';

const shortProvider = (label: string): string => label.replace(/\s*\(.*\)$/, '').trim();
const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

function timeAgo(ts: number, lang: 'ar' | 'en'): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (lang === 'ar') {
    if (s < 60) return 'الآن';
    const m = Math.floor(s / 60);
    if (m < 60) return `قبل ${m} دقيقة`;
    const h = Math.floor(m / 60);
    if (h < 24) return `قبل ${h} ساعة`;
    const d = Math.floor(h / 24);
    if (d < 30) return `قبل ${d} يوم`;
    return new Date(ts).toLocaleDateString('ar');
  }
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString('en');
}

/** One quiet metric tile — value always real, '—' when unknown (never faked). */
function Metric(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'bad' | 'acc';
  onClick?: () => void;
  title?: string;
}) {
  const toneColor =
    props.tone === 'ok' ? 'var(--ok)' : props.tone === 'warn' ? 'var(--warn)' : props.tone === 'bad' ? 'var(--bad)' : props.tone === 'acc' ? 'var(--acc)' : 'var(--ink)';
  return (
    <button
      type="button"
      className="hm-metric"
      onClick={props.onClick}
      title={props.title}
      disabled={!props.onClick}
    >
      <span className="hm-metric-ic" aria-hidden>{props.icon}</span>
      <span className="hm-metric-body">
        <span className="hm-metric-label">{props.label}</span>
        <span className="hm-metric-value truncate" style={{ color: toneColor }} dir="auto">
          {props.value}
        </span>
      </span>
      {props.onClick && <ChevronRight size={13} className="hm-metric-go" aria-hidden />}
    </button>
  );
}

/* An original 1px compass rose — four cardinal points, four intercardinal
   points, a ring and a centre register. Pure currentColor hairlines. */
function CompassRose() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="24" cy="24" r="18.5" opacity=".35" />
      <circle cx="24" cy="24" r="13" opacity=".22" />
      <path d="M24 3 26.6 21.4 45 24 26.6 26.6 24 45 21.4 26.6 3 24 21.4 21.4Z" />
      <path d="M38.8 9.2 28.4 19.6M9.2 9.2 19.6 19.6M38.8 38.8 28.4 28.4M9.2 38.8 19.6 28.4" opacity=".5" />
      <circle cx="24" cy="24" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* Engraved line geometry from a real numeric series (session tokens). */
function chartGeometry(values: number[], w = 320, h = 56, pad = 7) {
  if (values.length === 0) {
    return { d: `M${pad} ${h - pad}L${w - pad} ${h - pad}`, dots: [] as { x: number; y: number }[] };
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const xs = values.map((_, i) => (values.length === 1 ? w / 2 : pad + (i / (values.length - 1)) * (w - pad * 2)));
  const ys = values.map((v) => pad + (1 - (v - min) / span) * (h - pad * 2));
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
  return { d, dots: xs.map((x, i) => ({ x, y: ys[i] })) };
}

/* A small engraved chart drawn from the live store — one honest pen stroke
   over the recent-session token series, on a faint hatched plate. */
function HomeChart({ values, count, lang }: { values: number[]; count: number; lang: 'ar' | 'en' }) {
  const t = useT();
  const { d, dots } = chartGeometry(values);
  const label = t('hgs.home.chart', lang === 'ar' ? 'الرموز عبر الجلسات الأخيرة' : 'Tokens across recent sessions');
  const headLabel = t('hgs.home.chartLabel', lang === 'ar' ? 'الرموز / الجلسات الأخيرة' : 'TOKENS / RECENT SESSIONS');
  return (
    <div className="hgs-chart" aria-label={label}>
      <div className="hgs-chart-head">
        <span className="hgs-mono">{headLabel}</span>
        <span className="hgs-chart-rule" aria-hidden />
        <span className="hgs-mono tnum" dir="ltr">{String(count).padStart(2, '0')}</span>
      </div>
      <svg viewBox="0 0 320 56" preserveAspectRatio="none" aria-hidden="true">
        <line className="hgs-base" x1="7" y1="49" x2="313" y2="49" />
        <path className="hgs-line" pathLength={1} d={d} />
        {dots.map((p, i) => <circle key={i} className="hgs-dot" cx={p.x} cy={p.y} r={dots.length > 10 ? 1.4 : 2} />)}
      </svg>
    </div>
  );
}

export function Home() {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const wsPath = useStore((s) => s.wsPath);
  const sessions = useStore((s) => s.sessions);
  const openSession = useStore((s) => s.openSession);
  const newSession = useStore((s) => s.newSession);
  const running = useStore((s) => s.running);
  const activeGoal = useStore((s) => s.activeGoal);
  const subagentProgress = useStore((s) => s.subagentProgress);
  const queuedCount = useStore((s) => s.queuedCount);
  const git = useStore((s) => s.git);
  const mcpServers = useStore((s) => s.settings.mcpServers);
  const scheduledJobs = useStore((s) => s.scheduledJobs);
  const setScheduled = useStore((s) => s.setScheduled);
  const falseDoneStats = useStore((s) => s.falseDoneStats);
  const model = useStore((s) => s.settings.model);
  const provider = useStore((s) => s.settings.model.provider);
  const permMode = useStore((s) => s.settings.permissionMode);
  const recentPaths = useStore((s) => s.settings.recentPaths);
  const openWorkspace = useStore((s) => s.openWorkspace);
  const openFolderDialog = useStore((s) => s.openFolderDialog);
  const setRail = useStore((s) => s.setRail);
  const setSettings = useStore((s) => s.setSettings);
  const setModelPicker = useStore((s) => s.setModelPicker);
  const toggleChat = useStore((s) => s.toggleChat);
  const chatOpen = useStore((s) => s.chatOpen);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    const en = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const ar = h < 5 ? 'ليلة موفقة' : h < 12 ? 'صباح الخير' : h < 18 ? 'نهارك سعيد' : 'مساء الخير';
    return lang === 'ar' ? ar : en;
  }, [lang]);

  const recentSessions = useMemo(() => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6), [sessions]);
  // oldest → newest, so the engraved pen reads left to right through time.
  const chartSeries = useMemo(() => [...recentSessions].reverse().map((s) => s.totalTokens || 0), [recentSessions]);
  const recentProjects = (recentPaths || []).slice(0, 6);
  const subagents = Object.entries(subagentProgress || {});
  const gitChanged = git?.changed?.length ?? 0;
  const mcpEnabled = (mcpServers || []).filter((m: { enabled?: boolean }) => m.enabled !== false).length;
  const jobsEnabled = (scheduledJobs || []).filter((j) => j.enabled).length;

  return (
    <div className="page-v14 hm-page hgs-page set-scroll" role="main" aria-label={t('rail.home', 'Home')}>
      <div className="hm-inner">
        {/* ---------- editorial masthead ---------- */}
        <header className="hm-hero">
          <span className="hm-glyph hgs-glyph" aria-hidden><CompassRose /></span>
          <div className="hm-hero-tx min-w-0">
            <span className="pv14-eyebrow">{lang === 'ar' ? '٠٠ / الرئيسية' : '00 / HOME'}</span>
            <h1 className="hm-title" dir="auto">
              {greeting}
            </h1>
            <p className="hm-sub" dir="auto">
              {wsPath ? (
                <>
                  {t('home.workspace', 'Workspace')}: <span className="font-code text-[12px]" dir="ltr">{baseName(wsPath)}</span>
                </>
              ) : (
                t('home.noWorkspace', 'No workspace open — pick a folder to start.')
              )}
            </p>
          </div>
          <div className="hm-actions shrink-0">
            <button
              type="button"
              className="btn btn-primary hm-cta"
              onClick={() => {
                if (!chatOpen) toggleChat();
                void newSession();
              }}
            >
              <MessageSquarePlus size={14} aria-hidden />
              {t('home.newSession', 'New Session')}
            </button>
            <button type="button" className="btn hm-cta2" onClick={() => void openFolderDialog()}>
              <FolderOpen size={14} aria-hidden />
              {t('home.openProject', 'Open Project')}
            </button>
          </div>
        </header>

        {/* ---------- system metrics (all real) ---------- */}
        <div className="hm-sec-label">
          <span className="pv14-eyebrow">{t('home.system', 'At a glance')}</span>
          <span className="hm-sec-rule hgs-rule" aria-hidden />
        </div>
        <section className="hm-metrics hgs-metrics" aria-label={t('home.system', 'System status')}>
          <Metric
            icon={<Activity size={14} />}
            label={t('home.model', 'Model')}
            value={`${shortProvider(PROVIDER_PRESETS[provider]?.label ?? provider)} · ${model.model}`}
            tone="acc"
            title={t('palette.changeModel', 'Change AI model…')}
            onClick={() => setModelPicker(true)}
          />
          <Metric
            icon={<ShieldCheck size={14} />}
            label={t('home.permissions', 'Permissions')}
            value={t(`tb.mode.${permMode === 'default' ? 'default' : permMode}`, permMode)}
            onClick={() => setSettings(true)}
          />
          <Metric
            icon={<GitBranch size={14} />}
            label={t('home.git', 'Source control')}
            value={git ? (gitChanged > 0 ? `${gitChanged} ${t('home.changed', 'changed')}` : t('home.clean', 'Clean')) : t('home.noWsGit', '—')}
            tone={gitChanged > 0 ? 'warn' : git ? 'ok' : undefined}
            onClick={() => setRail('git')}
          />
          <Metric
            icon={<Plug size={14} />}
            label={t('home.mcp', 'MCP servers')}
            value={`${mcpEnabled}/${(mcpServers || []).length || 0}`}
            onClick={() => setRail('mcp')}
          />
          <Metric
            icon={<Timer size={14} />}
            label={t('home.jobs', 'Scheduled jobs')}
            value={`${jobsEnabled}/${(scheduledJobs || []).length || 0}`}
            onClick={() => setScheduled(true)}
          />
          <Metric
            icon={
              falseDoneStats && falseDoneStats.rate > 0 ? (
                <TriangleAlert size={14} />
              ) : (
                <ListChecks size={14} />
              )
            }
            label={t('home.falseDone', 'False-Done rate')}
            value={falseDoneStats ? `${Math.round(falseDoneStats.rate * 100)}%` : t('home.noRunsYet', 'no runs yet')}
            tone={falseDoneStats && falseDoneStats.rate > 0.05 ? 'warn' : falseDoneStats ? 'ok' : undefined}
            title={t('home.falseDone.hint', 'Published honesty metric — claims the proof gates caught')}
          />
        </section>

        {/* ---------- engraved at-a-glance chart (real store data) ---------- */}
        <HomeChart values={chartSeries} count={recentSessions.length} lang={lang} />

        {/* ---------- running now (only when something IS running) ---------- */}
        {(running || subagents.length > 0 || queuedCount > 0) && (
          <section className="hm-card" aria-label={t('home.running', 'Running now')}>
            <div className="hm-card-head">
              <span className="caps">{t('home.running', 'Running now')}</span>
              {queuedCount > 0 && (
                <span className="stamp !h-[18px]">{t('home.queued', '{n} queued', { n: queuedCount })}</span>
              )}
            </div>
            {activeGoal && (
              <div className="hm-goal">
                <span className="hm-goal-dot" aria-hidden />
                <span className="hm-goal-tx truncate" dir="auto">{activeGoal.goal}</span>
                {typeof activeGoal.pct === 'number' && (
                  <span className="tnum text-[11px] text-faint shrink-0">{Math.round(activeGoal.pct)}%</span>
                )}
              </div>
            )}
            {subagents.map(([id, p]) => (
              <div key={id} className="hm-goal">
                <span className="hm-goal-dot is-agent" aria-hidden />
                <span className="hm-goal-tx truncate" dir="auto">{p.label}</span>
                <span className="tnum text-[11px] text-faint shrink-0" dir="ltr">
                  {p.done}/{p.total}
                </span>
              </div>
            ))}
            {!activeGoal && subagents.length === 0 && running && (
              <div className="hm-goal">
                <span className="hm-goal-dot is-live" aria-hidden />
                <span className="hm-goal-tx truncate">{t('chat.working', 'Working…')}</span>
              </div>
            )}
          </section>
        )}

        {/* ---------- recent sessions ---------- */}
        <section className="hm-card" aria-label={t('home.recentSessions', 'Recent sessions')}>
          <div className="hm-card-head">
            <span className="caps">{t('home.recentSessions', 'Recent sessions')}</span>
            {recentSessions.length > 0 && (
              <button type="button" className="hm-more" onClick={() => setRail('sessions')}>
                {t('home.viewAll', 'View all')}
                <ChevronRight size={12} aria-hidden />
              </button>
            )}
          </div>
          {recentSessions.length === 0 ? (
            <div className="hm-empty">
              {/* v11.11 delight — calm lantern instead of a bare clock icon */}
              <img
                src={emptySessions}
                alt=""
                aria-hidden
                width={132}
                height={92}
                style={{ borderRadius: 10, marginBottom: 2 }}
              />
              <p>{t('home.noSessions', 'No sessions yet — start one from the composer or the quick action above.')}</p>
            </div>
          ) : (
            <ul className="hm-list">
              {recentSessions.map((s) => (
                <li key={s.id}>
                  <button type="button" className="hm-row" onClick={() => void openSession(s.id)}>
                    <span className="hm-row-dot" aria-hidden data-live={running} />
                    <span className="hm-row-tx min-w-0">
                      <span className="hm-row-title truncate" dir="auto">{s.title || s.id}</span>
                      <span className="hm-row-meta" dir="ltr">
                        {s.model ?? '—'} · {s.messageCount} msg · {Math.round(s.totalTokens / 1000)}k tok
                        {s.totalCostUsd > 0 ? ` · $${s.totalCostUsd.toFixed(3)}` : ''}
                      </span>
                    </span>
                    <span className="hm-row-time shrink-0">{timeAgo(s.updatedAt, lang)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------- recent projects ---------- */}
        <section className="hm-card" aria-label={t('home.recentProjects', 'Recent projects')}>
          <div className="hm-card-head">
            <span className="caps">{t('home.recentProjects', 'Recent projects')}</span>
          </div>
          {recentProjects.length === 0 ? (
            <div className="hm-empty">
              <FolderOpen size={18} aria-hidden />
              <p>{t('home.noProjects', 'No projects yet — open a folder to begin.')}</p>
              <button type="button" className="btn btn-primary" onClick={() => void openFolderDialog()}>
                <Plus size={14} aria-hidden />
                {t('home.openProject', 'Open Project')}
              </button>
            </div>
          ) : (
            <div className="hm-projects">
              {recentProjects.map((p) => (
                <button key={p} type="button" className="hm-proj" onClick={() => void openWorkspace(p)} title={p}>
                  <FolderOpen size={14} className="hm-proj-ic" aria-hidden />
                  <span className="hm-proj-name truncate" dir="auto">{baseName(p)}</span>
                  <span className="hm-proj-path truncate font-code" dir="ltr">{p}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ---------- footer: honest version stamp ---------- */}
        <footer className="hm-foot">
          <span className="stamp tnum !h-[18px]" dir="ltr">SADEEM v{APP_VERSION}</span>
          <span className="text-faint text-[11px]" dir="auto">
            {t('home.footerHint', 'The agent that must PROVE it is done.')}
          </span>
        </footer>
      </div>
    </div>
  );
}

export default Home;
