// SchedulePanel — v11.12 automation dashboard.
// A polished, self-contained surface for cron-scheduled headless agent jobs.
// SURVEYOR v4 kept the keyrow grammar; this edition adds a live "next run"
// hero with countdown, KPI strip, richer job rows (cadence / last run / next),
// inline quick actions (run now · toggle · edit · webhook · transcript ·
// remove), an editor with one-click cron presets, a loopback-webhook card with
// copy-to-clipboard, and a recent-runs strip.
// Palette unchanged (semantic tokens only) — all new styling lives in the
// stable schedule.css, never in versioned theme files.
// NOTE: schedule events are not bridged in preload (orchestrator-owned) —
// the panel re-polls scheduleList on open and after every mutation.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  Check,
  ChevronDown,
  Clock3,
  Folder,
  History,
  Link2,
  Pencil,
  Plus,
  Radio,
  RotateCw,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { ScheduleJob } from '../../../shared/types';
import { api } from '../../lib/api';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { Btn, IconBtn, TextInput } from '../ui';
import { Toggle } from '../settings/controls';
import '../schedule.css';

const base = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
type T = ReturnType<typeof useT>;

// v11.38 — the main service returns EXTRA runtime fields on each job (persisted
// nextRun / lastError / lastEvent / runCount …) and an honest webhook payload.
// The shared types are owned by another agent, so we widen locally (same
// posture as UsagePanel.modelInfo) instead of editing them.
interface ScheduleEventView {
  seq: number;
  jobId: string;
  jobName?: string;
  status: 'running' | 'ok' | 'error' | 'missed';
  at: number;
  sessionId?: string;
  message?: string;
}
type JobView = ScheduleJob & {
  nextRun?: number;
  lastFireSlot?: number;
  lastError?: string;
  consecutiveErrors?: number;
  runCount?: number;
  lastDurationMs?: number;
  lastEvent?: ScheduleEventView;
};

/** Localized relative time for "last run". */
function relLast(ts: number | undefined, t: T): string {
  if (!ts) return t('wscc.never', 'never');
  const d = Date.now() - ts;
  const m = Math.floor(d / 60_000);
  const h = Math.floor(d / 3_600_000);
  const dd = Math.floor(d / 86_400_000);
  if (m < 1) return t('time.now', 'now');
  if (h < 1) return t('time.ago', '{0} ago').replace('{0}', `${m}${t('time.m', 'm')}`);
  if (dd < 1) return t('time.ago', '{0} ago').replace('{0}', `${h}${t('time.h', 'h')}`);
  if (dd < 7) return t('time.ago', '{0} ago').replace('{0}', `${dd}${t('time.d', 'd')}`);
  return new Date(ts).toLocaleDateString();
}

// ---------------- next-run calculator (pure, no deps) ----------------
// v11.36 — THIS MIRRORS THE MAIN SCHEDULER'S MATCHER EXACTLY. The old panel
// calculator disagreed with `scheduleService.cronMatches()` in three ways:
//   · month field was compared with getMonth() (0-based) instead of getMonth()+1
//     → `0 9 * * 1` showed February instead of January;
//   · it used Vixie dom/dow OR semantics while the service uses AND (all fields
//     must match) → the countdown lied for day-restricted jobs;
//   · @monthly / @yearly were rejected although the service supports them.
// A countdown that disagrees with the fire is a lying number, so the panel now
// computes from the SAME field ranges, aliases and conjunction as the service.
type Fields = { min: Set<number>; hour: Set<number>; dom: Set<number>; mon: Set<number>; dow: Set<number> };

const CRON_ALIASES: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};

/** Same field parser as electron/services/scheduleService.ts (min..max, 7→0 dow). */
function parseField(raw: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    const p = part.trim();
    if (!p) return null;
    let body = p;
    let step = 1;
    const slash = p.indexOf('/');
    if (slash >= 0) {
      body = p.slice(0, slash);
      step = Number(p.slice(slash + 1));
      if (!Number.isInteger(step) || step < 1) return null;
    }
    let lo = min;
    let hi = max;
    if (body !== '*') {
      const dash = body.indexOf('-');
      if (dash >= 0) {
        const lhs = body.slice(0, dash);
        const rhs = body.slice(dash + 1);
        if (!lhs || !rhs) return null;
        lo = Number(lhs);
        hi = Number(rhs);
      } else {
        lo = Number(body);
        hi = step > 1 ? max : lo;
      }
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
      if (lo < min || hi > max || lo > hi) return null;
    }
    for (let v = lo; v <= hi; v += step) out.add(v === 7 && max === 7 ? 0 : v);
  }
  return out.size ? out : null;
}

/** Panel-side validity check — mirrors the main service's isValidCron. */
export function cronIsValid(expr: string): boolean {
  return parseCron(expr) !== null;
}

function parseCron(expr: string): Fields | null {
  const raw = String(expr ?? '').trim().toLowerCase();
  const e = CRON_ALIASES[raw] ?? raw;
  if (e.startsWith('@')) return null; // unknown alias — honest "—"
  const parts = e.split(/\s+/);
  if (parts.length !== 5) return null;
  const min = parseField(parts[0], 0, 59);
  const hour = parseField(parts[1], 0, 23);
  const dom = parseField(parts[2], 1, 31);
  const mon = parseField(parts[3], 1, 12);
  const dow = parseField(parts[4], 0, 7);
  if (!min || !hour || !dom || !mon || !dow) return null;
  return { min, hour, dom, mon, dow };
}

/**
 * Next fire time for a cron expression, matching the main 30s scheduler's
 * minute-resolution matcher. Day-stepping (not minute-stepping over a year)
 * keeps @yearly cheap. Returns 0 when the expression cannot be parsed (the UI
 * then shows "—"). Public export consumed by WorkspacePanel.
 */
export function cronNextRun(expr: string, from: Date = new Date()): number {
  const f = parseCron(expr);
  if (!f) return 0;
  const start = new Date(from.getTime());
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  const startMs = start.getTime();
  const limit = from.getTime() + 400 * 86_400_000;
  const hours = [...f.hour].sort((a, b) => a - b);
  const mins = [...f.min].sort((a, b) => a - b);
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (day.getTime() <= limit) {
    // AND conjunction — exactly `scheduleService.cronMatches()`.
    if (
      f.mon.has(day.getMonth() + 1) &&
      f.dom.has(day.getDate()) &&
      f.dow.has(day.getDay())
    ) {
      for (const h of hours) {
        for (const m of mins) {
          const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
          if (t >= startMs && t <= limit) return t;
        }
      }
    }
    day.setDate(day.getDate() + 1);
  }
  return 0;
}

/** Human cadence for the common presets; otherwise the raw cron stays readable. */
function cadenceLabel(cron: string, t: T): string {
  const c = cron.trim().toLowerCase();
  if (c === '* * * * *' || c === '*/1 * * * *') return t('sch.cad.min', 'Every minute');
  if (c === '@hourly' || c === '0 * * * *') return t('sch.cad.hour', 'Every hour');
  if (c === '@daily' || c === '0 0 * * *') return t('sch.cad.day0', 'Every day · midnight');
  if (c === '@weekly' || c === '0 0 * * 0') return t('sch.cad.week', 'Every week');
  const everyN = /^\*\/(\d+) \* \* \* \*$/.exec(c);
  if (everyN) return `${t('sch.cad.every', 'Every')} ${everyN[1]} ${t('time.m', 'm')}`;
  const hourMin = /^(\d{1,2}) (\d{1,2}) \* \* (1-5|1,2,3,4,5|0-4)$/.exec(c);
  if (hourMin) return `${t('sch.cad.weekdays', 'Weekdays')} · ${hourMin[2].padStart(2, '0')}:${hourMin[1].padStart(2, '0')}`;
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(c);
  if (daily) return `${t('sch.cad.day', 'Every day')} · ${daily[2].padStart(2, '0')}:${daily[1].padStart(2, '0')}`;
  const hourly = /^(\d{1,2}) \* \* \* \*$/.exec(c);
  if (hourly) return `${t('sch.cad.hourAt', 'Every hour')} · :${hourly[1].padStart(2, '0')}`;
  return `${t('sch.cad.cron', 'Cron')} · ${cron}`;
}

/** Job lifecycle stamp — ACTIVE / PAUSED / ERR (running shows ACTIVE+LED). */
function jobStamp(job: ScheduleJob, t: T): { label: string; cls: string } {
  if (!job.enabled) return { label: t('sched.state.paused', 'PAUSED'), cls: 'is-paused' };
  if (job.lastStatus === 'running') return { label: t('sched.state.running', 'RUNNING'), cls: 'is-running' };
  if (job.lastStatus === 'error') return { label: t('sched.state.err', 'ERROR'), cls: 'is-error' };
  return { label: t('sched.state.active', 'ACTIVE'), cls: 'is-ok' };
}

function fmtNext(at: number, now: number = Date.now()): string {
  if (!at) return '—';
  const d = new Date(at);
  const n = new Date(now);
  const sameDay = d.toDateString() === n.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Countdown clock: HH:MM:SS, with days when the next run is farther out. */
function fmtClock(ms: number): string {
  if (ms <= 0) return '00:00:00';
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  s %= 86_400;
  const h = Math.floor(s / 3_600);
  s %= 3_600;
  const m = Math.floor(s / 60);
  s %= 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}:${p(s)}`;
}

// ---------------- templates (ZCode Automations parity) ----------------
/**
 * Read-only analysis presets that prefill the editor (name · cron · prompt).
 * Clicking a card NEVER creates a job — the user reviews and saves.
 */
interface ScheduleTemplate {
  readonly id: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly descEn: string;
  readonly descAr: string;
  readonly cron: string;
  readonly prompt: string;
}

const TEMPLATES: readonly ScheduleTemplate[] = [
  {
    id: 'standup-digest',
    nameEn: 'Weekday standup digest',
    nameAr: 'ملخص وقفة أيام العمل',
    descEn: 'Yesterday commits + open TODOs as a short digest',
    descAr: 'ملخص قصير من التزامات الأمس والمهام المفتوحة',
    cron: '0 9 * * 1-5',
    prompt:
      "READ-ONLY analysis — no code changes, no file writes. Summarize yesterday's git commits plus the open TODOs in this workspace into a short standup digest. Verifiable facts only (git history, diffs, source comments) — no speculation, no invented items; if the evidence is thin, say so explicitly.",
  },
  {
    id: 'risk-scan',
    nameEn: 'Daily risk scan',
    nameAr: 'فحص المخاطر اليومي',
    descEn: 'Diffs & deps: secrets, TODO-fixmes, outdated criticals',
    descAr: 'فحص الفروقات والاعتمادات: أسرار، مهام معلقة، تبعيات قديمة',
    cron: '0 10 * * *',
    prompt:
      'READ-ONLY analysis — no code changes, no file writes. Scan recent diffs and dependency files for risky patterns: hardcoded secrets or secret placeholders, TODO/FIXME markers left in critical paths, and outdated critical dependencies. Report each finding with file-level evidence, and acknowledge explicitly when the evidence is thin.',
  },
  {
    id: 'release-brief',
    nameEn: 'Friday release brief',
    nameAr: 'موجز إصدار الجمعة',
    descEn: 'Weekly release notes grouped Added / Changed / Fixed',
    descAr: 'ملاحظات إصدار أسبوعية: مضاف / متغير / مُصلح',
    cron: '0 16 * * 5',
    prompt:
      "READ-ONLY analysis — no code changes, no file writes. Draft release notes from this week's git commits, grouped under Added / Changed / Fixed. Base every entry on what the commit history and diffs actually show; leave a group empty rather than inventing items.",
  },
  {
    id: 'doc-sync',
    nameEn: 'Wednesday doc sync',
    nameAr: 'مزامنة التوثيق الأربعاء',
    descEn: 'README/docs vs the actual code structure — list drift',
    descAr: 'مقارنة التوثيق ببنية الكود الفعلية وإدراج الفجوات',
    cron: '0 11 * * 3',
    prompt:
      'READ-ONLY analysis — no code changes, no file writes. Compare README and docs against the actual code structure (directories, entry points, scripts, commands) and list every drift: documented-but-missing, present-but-undocumented, and stale instructions. Facts only, each with a file path as evidence.',
  },
];

interface WebhookInfo {
  url: string;
  token: string;
  /** v11.38 — honest listener state from kdx:schedule:webhook. */
  listening?: boolean;
  port?: number | null;
  error?: string | null;
}

interface Draft {
  id?: string;
  name: string;
  prompt: string;
  cron: string;
  workspace: string;
  mode: 'read' | 'autoEdit' | 'fullAccess';
  enabled: boolean;
}

export function SchedulePanel({ embedded }: { embedded?: boolean }) {
  const t = useT();
  const jobs = useStore((s) => s.scheduledJobs);
  const wsPath = useStore((s) => s.wsPath);
  const loadJobs = useStore((s) => s.loadJobs);
  const scheduleAdd = useStore((s) => s.scheduleAdd);
  const scheduleRemoveJob = useStore((s) => s.scheduleRemoveJob);
  const scheduleToggleJob = useStore((s) => s.scheduleToggleJob);
  const scheduleRunJobNow = useStore((s) => s.scheduleRunJobNow);
  const openSession = useStore((s) => s.openSession);

  const lang = useStore((s) => s.settings?.language ?? 'en');
  const ar = lang === 'ar';

  const [formOpen, setFormOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    name: '',
    prompt: '',
    cron: '@daily',
    workspace: '',
    mode: 'autoEdit',
    enabled: true,
  });
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [wh, setWh] = useState<WebhookInfo | null>(null);
  const [copied, setCopied] = useState('');

  // 1s countdown tick. Cron is minute-granular, so next-run computation is
  // memoized per minute; only the countdown display re-renders every second.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  // v11.36 — jobs are NOT event-bridged in this build. Re-poll so a real fire
  // (lastRun / lastStatus) shows up without a manual refresh — the old page
  // could show a stale "never ran" forever even while jobs were firing.
  useEffect(() => {
    const iv = window.setInterval(() => void loadJobs(), 5_000);
    return () => window.clearInterval(iv);
  }, [loadJobs]);

  // v11.38 — EVENT CONSUMPTION. The service writes a durable event onto every
  // job (`lastEvent`) and broadcasts 'kdx:schedule-event' (main → window). The
  // preload has no schedule-event subscription (HANDOFF), so the panel consumes
  // the SAME emitted events from its 5s scheduleList re-poll: no event is
  // invented, and a new event seq produces a real "just fired" flash.
  const bridgeOk =
    typeof api.scheduleList === 'function' &&
    typeof api.scheduleAdd === 'function' &&
    typeof api.scheduleRunNow === 'function';
  // v11.38 — cancel bridge is optional (preload/api.ts handoff). A dead button
  // is worse than no button, so only render it when the channel really exists.
  const cancelBridge = (api as unknown as { scheduleCancel?: (id: string) => Promise<boolean> }).scheduleCancel;
  const bridgeCancelOk = typeof cancelBridge === 'function';
  const jobViews = jobs as JobView[];
  const latestEvent = jobViews.reduce<ScheduleEventView | null>((best, j) => {
    const e = j.lastEvent;
    return e && (!best || e.seq > best.seq) ? e : best;
  }, null);
  const seenSeq = useRef(0);
  const [evtFlash, setEvtFlash] = useState(false);
  useEffect(() => {
    if (!latestEvent || latestEvent.seq <= seenSeq.current) return;
    seenSeq.current = latestEvent.seq;
    setEvtFlash(true);
    const id = window.setTimeout(() => setEvtFlash(false), 2500);
    return () => window.clearTimeout(id);
  }, [latestEvent?.seq]);

  const observedRun = jobViews.some(
    (j) => (typeof j.lastRun === 'number' && j.lastRun > 0) || !!j.lastEvent,
  );
  const clockState: 'unavailable' | 'observed' | 'unverified' = !bridgeOk
    ? 'unavailable'
    : observedRun
      ? 'observed'
      : 'unverified';
  const clockText =
    clockState === 'unavailable'
      ? t('sch.clock.off', 'SCHEDULER UNAVAILABLE — no bridge in this build')
      : clockState === 'observed'
        ? latestEvent
          ? t('sch.clock.liveEvt', 'CLOCK OBSERVED — last real fire {0} ({1})')
              .replace('{0}', relLast(latestEvent.at, t))
              .replace('{1}', latestEvent.status)
          : t('sch.clock.live', 'CLOCK OBSERVED — a real fire was recorded')
        : t('sch.clock.unverified', 'CLOCK UNVERIFIED — no run observed yet; Run now / webhook are the direct triggers');

  // The main process already registers kdx:schedule:webhook; the renderer
  // bridge is optional (older preload → webhook card degrades gracefully).
  const loadWebhook = (): void => {
    try {
      void api
        .scheduleWebhook?.()
        .then((info) => {
          if (info && typeof info.url === 'string' && typeof info.token === 'string') setWh(info);
        })
        .catch(() => setWh(null));
    } catch {
      setWh(null);
    }
  };
  useEffect(() => {
    loadWebhook();
  }, []);

  /** Manual refresh — jobs are not event-bridged, so give the user a control. */
  const refreshAll = (): void => {
    void loadJobs();
    loadWebhook();
  };

  const minuteKey = Math.floor(now / 60_000);
  const nextRuns = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobViews) {
      // Prefer the scheduler's persisted exact value; fall back to the local
      // mirror for older jobs / bridges that do not carry nextRun.
      const exact = typeof j.nextRun === 'number' && j.nextRun > 0 ? j.nextRun : 0;
      m.set(j.id, exact || cronNextRun(j.cron));
    }
    return m;
  }, [jobs, minuteKey]);

  const sorted = useMemo(
    () => [...jobs].sort((a, b) => (nextRuns.get(a.id) || Infinity) - (nextRuns.get(b.id) || Infinity)),
    [jobs, nextRuns],
  );

  const hero = sorted.find((j) => j.enabled && nextRuns.get(j.id)) ?? null;
  const heroAt = hero ? nextRuns.get(hero.id) ?? 0 : 0;
  const remaining = heroAt ? Math.max(0, heroAt - now) : 0;

  // Countdown track resets whenever the hero target changes.
  const heroKey = hero && heroAt ? `${hero.id}|${heroAt}` : '';
  const [heroStart, setHeroStart] = useState(Date.now());
  useEffect(() => {
    setHeroStart(Date.now());
  }, [heroKey]);
  const progress = heroAt
    ? Math.max(0, Math.min(1, 1 - (now - heroStart) / Math.max(1, heroAt - heroStart)))
    : 0;

  const activeN = jobs.filter((j) => j.enabled).length;
  const pausedN = jobs.length - activeN;
  const errorN = jobs.filter((j) => j.lastStatus === 'error').length;
  const ranN = jobs.filter((j) => typeof j.lastRun === 'number').length;
  const history = useMemo(
    () =>
      jobs
        .filter((j) => typeof j.lastRun === 'number')
        .sort((a, b) => (b.lastRun ?? 0) - (a.lastRun ?? 0))
        .slice(0, 8),
    [jobs],
  );

  const presets = [
    { id: 'min', label: t('sch.preset.min', 'Every minute'), cron: '* * * * *' },
    { id: 'hour', label: t('sch.preset.hour', 'Every hour'), cron: '@hourly' },
    { id: 'day', label: t('sch.preset.day', 'Every day'), cron: '0 9 * * *' },
    { id: 'weekday', label: t('sch.preset.weekday', 'Weekdays'), cron: '0 9 * * 1-5' },
  ];

  const openNew = (): void => {
    setDraft({ name: '', prompt: '', cron: '@daily', workspace: wsPath, mode: 'autoEdit', enabled: true });
    setFormOpen(true);
  };

  const openEdit = (job: ScheduleJob): void => {
    setDraft({
      id: job.id,
      name: job.name,
      prompt: job.prompt,
      cron: job.cron,
      workspace: job.workspace,
      mode: job.mode ?? 'autoEdit',
      enabled: job.enabled,
    });
    setFormOpen(true);
  };

  /** Prefill the editor from a template — review, then save. Never auto-creates. */
  const applyTemplate = (tpl: ScheduleTemplate): void => {
    setDraft((d) => ({ ...d, name: ar ? tpl.nameAr : tpl.nameEn, cron: tpl.cron, prompt: tpl.prompt }));
    setFormOpen(true);
  };

  const submit = async (): Promise<void> => {
    const name = draft.name.trim();
    const prompt = draft.prompt.trim();
    const cron = draft.cron.trim();
    if (!bridgeOk) {
      useStore.getState().notify(t('sch.clock.off', 'SCHEDULER UNAVAILABLE — no bridge in this build'));
      return;
    }
    if (!name || !prompt || !cron) {
      useStore.getState().notify(t('sched.required', 'Name, prompt and cron are required'));
      return;
    }
    const workspace = (draft.workspace || wsPath).trim();
    if (!workspace) {
      useStore.getState().notify(t('misc.notify.noWorkspace', 'Open a workspace first'));
      return;
    }
    if (!cronIsValid(cron)) {
      useStore.getState().notify(t('sch.badCron', 'Cron is invalid — no next run can be computed'));
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name,
        prompt,
        cron,
        workspace: (draft.workspace || wsPath).trim(),
        enabled: draft.enabled,
        mode: draft.mode,
      };
      // store.scheduleAdd() swallows bridge errors and resolves normally, so a
      // success toast based on "await returned" is a lie. Re-read the list and
      // confirm the row actually landed before claiming anything was saved.
      const landed = async (): Promise<boolean> => {
        await loadJobs();
        return useStore
          .getState()
          .scheduledJobs.some(
            (j) => j.id !== draft.id && j.name === name && j.prompt === prompt && j.cron === cron,
          );
      };
      if (draft.id) {
        // No update IPC exists — recreate from the edited fields. Add FIRST so a
        // validation failure keeps the original job, then verify it landed,
        // and only then remove the old id.
        await scheduleAdd(payload);
        if (!(await landed())) {
          useStore.getState().notify(t('sch.editFailed', 'Update failed — the original job was kept'));
          return;
        }
        await scheduleRemoveJob(draft.id);
        useStore.getState().notify(t('sch.recreated', 'Job updated — run history and advanced triggers were reset'));
      } else {
        await scheduleAdd(payload);
        if (!(await landed())) {
          useStore.getState().notify(t('sch.createFailed', 'Could not create the job — nothing was saved'));
          return;
        }
        useStore.getState().notify(t('sched.created', 'Job created'));
      }
      setFormOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, label: string): Promise<void> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1600);
    } catch {
      useStore.getState().notify(t('sch.copyFail', 'Could not copy to clipboard'));
    }
  };

  // v11.38 — a token alone does NOT make a listener ready (the old card lied
  // when port 7681 was taken). Trust only the listener's own reported state.
  const whReady = !!wh && wh.listening === true;
  const whBadge = !wh
    ? t('sch.webhook.off', 'UNAVAILABLE')
    : whReady
      ? t('sch.webhook.live', 'LISTENER READY')
      : t('sch.webhook.down', 'LISTENER DOWN');
  const whTemplate = wh
    ? `${wh.url}?token=${wh.token}`
    : 'http://127.0.0.1:7681/trigger/<jobId>?token=<token>';
  const jobWebhookUrl = (job: ScheduleJob): string =>
    wh ? `${wh.url.replace('<jobId>', encodeURIComponent(job.id))}?token=${wh.token}` : whTemplate;

  return (
    <div className={`sch-root ${embedded ? 'is-embedded' : ''}`}>
      {/* ---------------- clean header ---------------- */}
      <header className="sch-head">
        <div className="sch-head-copy">
          <span className="sch-eyebrow">{t('sch.eyebrow', 'AUTOMATION · SCHEDULE')}</span>
          <h2 className="sch-title">{t('sched.title', 'Scheduled jobs')}</h2>
          <p className="sch-sub">
            {t('sch.sub', 'Headless agent jobs on a cron clock — quiet, repeatable, verifiable.')}
          </p>
        </div>
        <div className="sch-head-actions">
          <span className="sch-count" title={t('sched.title', 'Scheduled jobs')}>
            {jobs.length} {jobs.length === 1 ? t('sch.job1', 'job') : t('sch.jobs', 'jobs')}
          </span>
          <IconBtn
            className="sch-refresh"
            title={t('sch.refresh', 'Refresh jobs')}
            aria-label={t('sch.refresh', 'Refresh jobs')}
            onClick={refreshAll}
          >
            <RotateCw size={13} />
          </IconBtn>
          <Btn variant="primary" className="sch-new" onClick={openNew} disabled={formOpen || !bridgeOk} title={t('sched.add', 'Add job')}>
            {formOpen ? <X size={13} /> : <Plus size={13} />}
            {formOpen ? t('ws.cancel', 'Cancel') : t('sched.add', 'New job')}
          </Btn>
        </div>
      </header>

      {/* ---------------- KPI strip ---------------- */}
      <div className="sch-kpis">
        <div className="sch-kpi">
          <span className="sch-kpi-label">{t('sch.kpi.active', 'Active')}</span>
          <span className="sch-kpi-value is-ok">{activeN}</span>
        </div>
        <div className="sch-kpi">
          <span className="sch-kpi-label">{t('sch.kpi.paused', 'Paused')}</span>
          <span className="sch-kpi-value">{pausedN}</span>
        </div>
        <div className="sch-kpi">
          <span className="sch-kpi-label">{t('sch.kpi.errors', 'Last-run errors')}</span>
          <span className={`sch-kpi-value ${errorN ? 'is-error' : ''}`}>{errorN}</span>
        </div>
        <div className="sch-kpi">
          <span className="sch-kpi-label">{t('sch.kpi.ran', 'Jobs with a run')}</span>
          <span className="sch-kpi-value">{ranN}</span>
        </div>
      </div>

      {/* v11.36 — honest clock state (never claim ACTIVE without a real fire) */}
      <div
        className={`sch-hist-note ${clockState === 'observed' ? 'is-live' : ''} ${evtFlash ? 'is-flash' : ''}`}
        role="status"
        data-clock-state={clockState}
        data-flash={evtFlash ? '1' : '0'}
        data-last-event={latestEvent?.status ?? ''}
        title={clockText}
        style={{ color: clockState === 'unavailable' ? 'var(--warn)' : undefined }}
      >
        <Radio size={10} className={clockState === 'observed' || evtFlash ? 'is-live' : ''} aria-hidden="true" /> {clockText}
      </div>

      {/* ---------------- next-run hero ---------------- */}
      <div className={`sch-hero ${hero ? '' : 'is-empty'}`}>
        <div className="sch-hero-main">
          <div className="sch-hero-eyebrow">
            <span className={`sch-hero-led ${hero ? 'is-live' : ''}`} />
            {t('sch.hero.label', 'NEXT SCHEDULED RUN')}
          </div>
          {hero ? (
            <>
              <div className="sch-hero-name" title={hero.name}>
                {hero.name}
              </div>
              <div className="sch-hero-clock tnum" dir="ltr">
                {fmtClock(remaining)}
              </div>
              <div className="sch-hero-abs">
                <CalendarClock size={11} />
                {fmtNext(heroAt, now)} · {cadenceLabel(hero.cron, t)}
              </div>
            </>
          ) : (
            <>
              <div className="sch-hero-name">{t('sch.hero.empty', 'Nothing scheduled yet')}</div>
              <div className="sch-hero-clock is-empty tnum" dir="ltr">
                --:--:--
              </div>
              <div className="sch-hero-abs">
                {t('sch.hero.emptySub', 'Add a job to see a live countdown here.')}
              </div>
            </>
          )}
        </div>
        <div className="sch-hero-side">
          <div className="sch-hero-side-label">{t('sch.hero.progress', 'COUNTDOWN')}</div>
          <div className="sch-hero-track">
            <span className="sch-hero-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="sch-hero-side-foot tnum">
            {hero ? `${Math.ceil(remaining / 60_000)} ${t('time.m', 'm')} ${t('sch.hero.left', 'left')}` : '—'}
          </div>
        </div>
      </div>

      {/* ---------------- editor (inline) ---------------- */}
      {formOpen && (
        <div className="sch-editor anim-in">
          <div className="sch-editor-head">
            <div>
              <span className="sch-editor-title">
                {draft.id ? t('sched.edit', 'Edit job') : t('sched.add', 'New job')}
              </span>
              <span className="sch-editor-sub">
                {t('sch.editor.sub', 'Name · prompt · cadence · permission ceiling')}
              </span>
            </div>
            <IconBtn className="!w-6 !h-6" title={t('flows.cancel', 'Cancel')} onClick={() => setFormOpen(false)}>
              <X size={12} />
            </IconBtn>
          </div>

          <div className="sch-editor-grid">
            <label className="sch-field">
              <span className="sch-label">{t('sched.name', 'Job name')}</span>
              <TextInput
                autoFocus
                value={draft.name}
                placeholder={t('sched.namePh', 'Daily standup digest…')}
                className="sch-input"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="sch-field">
              <span className="sch-label">{t('sched.workspace', 'Workspace')}</span>
              <TextInput
                value={draft.workspace}
                placeholder={wsPath || t('misc.notify.noWorkspace', 'Open a workspace first')}
                className="sch-input tnum"
                dir="ltr"
                onChange={(e) => setDraft({ ...draft, workspace: e.target.value })}
              />
            </label>
          </div>

          <label className="sch-field">
            <span className="sch-label">{t('sched.prompt', 'Prompt')}</span>
            <textarea
              value={draft.prompt}
              placeholder={t('sched.promptPh', 'What should the agent do on each run?')}
              rows={3}
              dir="auto"
              className="sch-textarea"
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            />
          </label>

          <div className="sch-field">
            <span className="sch-label">{t('sched.cron', 'Schedule')}</span>
            <div className="sch-presetchips" role="group" aria-label={t('sch.presets', 'Quick presets')}>
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`sch-chip ${draft.cron.trim() === p.cron ? 'is-on' : ''}`}
                  onClick={() => setDraft({ ...draft, cron: p.cron })}
                >
                  {draft.cron.trim() === p.cron ? <Check size={10} /> : null}
                  {p.label}
                </button>
              ))}
            </div>
            <TextInput
              value={draft.cron}
              placeholder={t('sched.cronPh', '@daily أو 0 9 * * 1-5')}
              className="sch-input tnum"
              dir="ltr"
              onChange={(e) => setDraft({ ...draft, cron: e.target.value })}
            />
            <span className="sch-hint">{t('sched.cronHint', '5-field cron or @hourly @daily @weekly')}</span>
          </div>

          <div className="sch-field">
            <span className="sch-label">{t('sch.mode', 'Permission ceiling')}</span>
            <div className="sch-seg" role="group" aria-label={t('sch.mode', 'Permission ceiling')}>
              {(
                [
                  { id: 'read' as const, label: t('sch.mode.read', 'Read-only') },
                  { id: 'autoEdit' as const, label: t('sch.mode.auto', 'Auto-edit') },
                  { id: 'fullAccess' as const, label: t('sch.mode.full', 'Full access') },
                ]
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`sch-seg-btn ${draft.mode === m.id ? 'is-on' : ''}`}
                  aria-pressed={draft.mode === m.id}
                  onClick={() => setDraft({ ...draft, mode: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sch-editor-foot">
            <label className="sch-editor-enable">
              <Toggle
                checked={draft.enabled}
                onChange={(v) => setDraft({ ...draft, enabled: v })}
                label={t('sched.toggle', 'Enable job')}
              />
              <span>{t('sch.enabled', 'Enabled')}</span>
            </label>
            <span className="flex-1" />
            <Btn className="!h-7 !text-[11.5px]" onClick={() => setFormOpen(false)}>
              {t('flows.cancel', 'Cancel')}
            </Btn>
            <Btn variant="primary" className="!h-7 !text-[11.5px]" disabled={busy} onClick={() => void submit()}>
              <Plus size={12} />
              {draft.id ? t('flows.save', 'Save changes') : t('sched.add', 'Add job')}
            </Btn>
          </div>
          <p className="sch-editor-note">
            {draft.id
              ? t('sch.editNote', 'Editing recreates the job — run history, advanced triggers and the transcript link reset.')
              : t('sch.addNote', 'Approvals are auto-denied on headless runs; a failing test gate suppresses the result.')}
          </p>
        </div>
      )}

      {/* ---------------- templates (read-only presets) ---------------- */}
      <div className="sch-presets-wrap">
        <button
          type="button"
          className="sch-presets-head"
          aria-expanded={tplOpen}
          onClick={() => setTplOpen((v) => !v)}
        >
          <ChevronDown size={11} className={`sch-chev ${tplOpen ? 'is-open' : ''}`} />
          <span className="sch-section-tt">{t('sched.templates', 'Analysis templates')}</span>
          <span className="sch-presets-hint">{t('sch.readOnly', 'READ-ONLY')}</span>
          <span className="sch-rule" />
        </button>
        {tplOpen && (
          <div className="sch-presets-grid anim-in">
            {TEMPLATES.map((tpl) => (
              <button key={tpl.id} type="button" className="sch-preset" title={tpl.prompt} onClick={() => applyTemplate(tpl)}>
                <span className="sch-preset-name">{ar ? tpl.nameAr : tpl.nameEn}</span>
                <span className="sch-preset-cron tnum" dir="ltr">
                  {tpl.cron}
                </span>
                <span className="sch-preset-desc">{ar ? tpl.descAr : tpl.descEn}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---------------- job list ---------------- */}
      <section className="sch-section">
        <div className="sch-section-head">
          <span className="sch-section-tt">{t('sch.list', 'Jobs')}</span>
          <span className="sch-section-count tnum">{jobs.length}</span>
          <span className="sch-rule" />
        </div>
        {sorted.length === 0 ? (
          <div className="sch-empty">
            <CalendarClock size={22} strokeWidth={1.5} aria-hidden />
            <div className="sch-empty-title">{t('sched.empty.title', 'No scheduled jobs yet')}</div>
            <div className="sch-empty-sub">
              {t('sched.empty.sub', 'Automate reviews, digests or maintenance — the agent runs them on a cron.')}
            </div>
            {!formOpen && (
              <Btn className="!h-7 !text-[11px]" onClick={openNew}>
                <Plus size={12} />
                {t('sched.add', 'Add job')}
              </Btn>
            )}
          </div>
        ) : (
          <div className="sch-jobs">
            {sorted.map((job) => {
              const st = jobStamp(job, t);
              const jv = job as JobView;
              const nextAt = nextRuns.get(job.id) ?? 0;
              return (
                <div key={job.id} className={`sch-job ${job.enabled ? '' : 'is-off'}`} title={job.prompt}>
                  <span
                    className={`sch-job-led ${job.lastStatus === 'running' ? 'is-running' : job.lastStatus === 'error' ? 'is-error' : job.enabled ? 'is-ok' : 'is-idle'}`}
                    title={st.label}
                  />
                  <div className="sch-job-main">
                    <div className="sch-job-top">
                      <span className="sch-job-name" title={job.name}>
                        {job.name}
                      </span>
                      <span className={`sch-stamp ${st.cls}`}>{st.label}</span>
                      {job.trigger && job.trigger.kind !== 'cron' ? (
                        <span className="sch-tag">{String(job.trigger.kind)}</span>
                      ) : null}
                    </div>
                    <div className="sch-job-sub" dir="ltr">
                      <span className="sch-code" title={t('sched.cron', 'Cron schedule')}>
                        {job.cron}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="sch-cadence">{cadenceLabel(job.cron, t)}</span>
                    </div>
                    <div className="sch-job-meta">
                      <span title={job.workspace}>
                        <Folder size={10} />
                        {job.workspace ? base(job.workspace) : '—'}
                      </span>
                      <span>
                        <Clock3 size={10} />
                        {t('sched.lastRun', 'Last run')}: {relLast(job.lastRun, t)}
                      </span>
                      <span>
                        <CalendarClock size={10} />
                        {t('sched.next', 'Next')}: {fmtNext(nextAt, now)}
                      </span>
                    </div>
                    {jv.lastMessage || jv.lastEvent ? (
                      <div
                        className={`sch-job-msg ${jv.lastStatus === 'error' ? 'is-error' : ''} ${evtFlash && jv.lastEvent?.seq === latestEvent?.seq ? 'is-flash' : ''}`}
                        title={jv.lastError || jv.lastMessage || ''}
                        data-event-seq={jv.lastEvent?.seq ?? 0}
                      >
                        {jv.lastError || jv.lastMessage}
                        {jv.lastEvent ? ` · #${jv.lastEvent.seq} ${relLast(jv.lastEvent.at, t)}` : ''}
                      </div>
                    ) : null}
                  </div>
                  <div className="sch-job-actions">
                    <IconBtn
                      className="sch-icon"
                      title={
                        !bridgeOk
                          ? t('sch.clock.off', 'Scheduler unavailable')
                          : !job.workspace
                            ? t('sched.noWorkspaceRun', 'No workspace — run would report an honest error')
                            : t('sched.runNow', 'Run now')
                      }
                      disabled={!bridgeOk || !job.workspace || job.lastStatus === 'running'}
                      onClick={() => void scheduleRunJobNow(job.id)}
                    >
                      <Zap size={12} />
                    </IconBtn>
                    {job.lastStatus === 'running' && bridgeCancelOk ? (
                      <IconBtn
                        className="sch-icon is-danger"
                        title={t('sched.cancel', 'Cancel this run')}
                        onClick={() => void cancelBridge!(job.id).then(() => loadJobs())}
                      >
                        <X size={12} />
                      </IconBtn>
                    ) : null}
                    <span className="sch-switch" title={t('sched.toggle', 'Enable job')}>
                      <Toggle
                        checked={job.enabled}
                        disabled={!bridgeOk}
                        onChange={(v) => void scheduleToggleJob(job.id, v)}
                        label={t('sched.toggle', 'Enable job')}
                      />
                    </span>
                    <IconBtn className="sch-icon" title={t('sched.edit', 'Edit job')} onClick={() => openEdit(job)}>
                      <Pencil size={12} />
                    </IconBtn>
                    <IconBtn
                      className="sch-icon"
                      title={t('sch.webhook.copyJob', 'Copy this job’s webhook URL')}
                      disabled={!wh}
                      onClick={() => void copy(jobWebhookUrl(job), `job-${job.id}`)}
                    >
                      {copied === `job-${job.id}` ? <Check size={12} /> : <Link2 size={12} />}
                    </IconBtn>
                    {job.sessionId ? (
                      <IconBtn
                        className="sch-icon"
                        title={t('sched.openChat', 'Open the session transcript')}
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('surnia:session-loading'));
                          void openSession(job.sessionId!).finally(() =>
                            window.dispatchEvent(new CustomEvent('surnia:session-loaded')),
                          );
                        }}
                      >
                        <History size={12} />
                      </IconBtn>
                    ) : null}
                    <IconBtn
                      className="sch-icon is-danger"
                      title={t('ws.delete', 'Delete')}
                      onClick={() => {
                        if (window.confirm(t('sched.confirmRemove', 'Delete this job?'))) void scheduleRemoveJob(job.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </IconBtn>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------------- webhook card ---------------- */}
      <section className="sch-webhook">
        <div className="sch-webhook-head">
          <Radio size={12} className={whReady ? 'is-live' : ''} />
          <span className="sch-section-tt">{t('sch.webhook.title', 'Webhook trigger')}</span>
          <span className="sch-rule" />
          <span className="sch-presets-hint" data-webhook-state={whReady ? 'ready' : 'down'}>{whBadge}</span>
        </div>
        <p className="sch-webhook-desc">
          {wh && !whReady && wh.error
            ? `${t('sch.webhook.down', 'LISTENER DOWN')}: ${wh.error}`
            : t('sch.webhook.desc', 'Loopback-only POST /trigger/<jobId>?token=… — fires the job without the cron clock.')}
        </p>
        <div className="sch-webhook-url tnum" dir="ltr" title={whTemplate}>
          {whTemplate}
        </div>
        <div className="sch-webhook-actions">
          <Btn className="!h-7 !text-[11px]" disabled={!wh} onClick={() => void copy(whTemplate, 'template')}>
            {copied === 'template' ? <Check size={11} /> : <Link2 size={11} />}
            {t('sch.webhook.copyUrl', 'Copy URL template')}
          </Btn>
          <Btn className="!h-7 !text-[11px]" disabled={!wh} onClick={() => void copy(wh?.token ?? '', 'token')}>
            {copied === 'token' ? <Check size={11} /> : <CopyIcon />}
            {t('sch.webhook.copyToken', 'Copy token')}
          </Btn>
          {ar ? null : <span className="sch-webhook-note">{t('sch.webhook.tokenNote', 'Keep the token private — it grants trigger access.')}</span>}
        </div>
      </section>

      {/* ---------------- recent-runs strip ---------------- */}
      <section className="sch-section">
        <div className="sch-section-head">
          <span className="sch-section-tt">{t('sch.history.title', 'Recent runs')}</span>
          <span className="sch-hist-note">{t('sch.history.note', 'last run per job')}</span>
          <span className="sch-rule" />
        </div>
        {history.length === 0 ? (
          <div className="sch-history-empty">{t('sch.history.empty', 'No job has run yet. Results will collect here.')}</div>
        ) : (
          <div className="sch-history">
            {history.map((j) => (
              <div key={j.id} className="sch-hist">
                <span
                  className={`sch-hist-dot ${j.lastStatus === 'error' ? 'is-error' : j.lastStatus === 'running' ? 'is-running' : 'is-ok'}`}
                />
                <span className="sch-hist-name" title={j.name}>
                  {j.name}
                </span>
                <span className="sch-hist-time tnum">{relLast(j.lastRun, t)}</span>
                <span className="sch-hist-msg" title={j.lastMessage ?? ''}>
                  {j.lastMessage ?? (j.lastStatus ?? '—')}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Tiny copy glyph — keeps the lucide import surface small. */
function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export default SchedulePanel;
