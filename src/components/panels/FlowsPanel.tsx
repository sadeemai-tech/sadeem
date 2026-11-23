// FlowsPanel — the Flows page (rail 07). Editorial skin, honest language.
//
// WHAT A FLOW IS: a saved, named PROMPT. Running one re-sends that exact text
// through the normal chat path (store.sendMessage) and best-effort calls
// flowsMarkRun(id) so the run record stays accurate. A flow is NOT an
// autonomous job — scheduled crons are a separate feature with a proof gate.
// The page says this out loud in the comparison strip and the page lede.
//
// Everything here stays defensive: every flows IPC call is guarded, so the
// page renders even before the bridge lands. New copy uses the established
// `t('key', ar ? 'العربية' : 'English')` bilingual-fallback pattern (i18n.ts
// is owned by another agent — no new keys are added there).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Folder, Globe, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { Btn, IconBtn, Spinner } from '../ui';
import type { Flow } from '../../../shared/types';
import '../flows.css';
import '../pages.css';

/** Guarded bridge to the flows IPC — absent methods degrade to no-ops. */
interface FlowInfoBridge {
  globalCount: number;
  workspaceCount: number;
  hitsTracked: number;
  /** v11.38 — extra honesty fields (supertype of shared FlowsInfo). */
  repeatedPrompts?: number;
  suggestionTexts?: string[];
}
interface FlowsBridge {
  flowsList?(ws?: string): Promise<Flow[]>;
  flowsSave?(f: { id?: string; name: string; prompt: string; scope: 'global' | 'workspace' }, ws?: string): Promise<Flow[]>;
  flowsDelete?(id: string, ws?: string): Promise<Flow[]>;
  flowsMarkRun?(id: string, ws?: string): Promise<boolean | void>;
  flowsInfo?(ws?: string): Promise<FlowInfoBridge>;
}
const flowsApi = api as unknown as FlowsBridge;

/** Inline editor draft — a new flow when `id` is undefined. */
interface FlowDraft {
  id?: string;
  name: string;
  prompt: string;
  scope: 'global' | 'workspace';
}

export type RunStatus = 'queued' | 'running' | 'done' | 'error';

/* ============================================================
   v11.36 — honest, pure run bookkeeping (no React, unit-testable).
   A flow does NOT silently become "done": each real step of the run
   path is tracked and rendered. The run is only recorded after the
   chat turn actually settles successfully.
   ============================================================ */

export interface FlowRunFlags {
  sent?: boolean;
  queued?: boolean;
  recorded?: boolean;
  recordError?: boolean;
  /** v11.38 — a real chat turn was observed (running false→true). */
  settled?: boolean;
  /** sendMessage returned without starting any turn — nothing ran. */
  noTurn?: boolean;
  /** the chat turn did not settle inside the watchdog window. */
  timedOut?: boolean;
}

export interface FlowRunStep {
  id: 'gate' | 'sent' | 'running' | 'recorded' | 'finished';
  label: string;
  state: 'done' | 'active' | 'pending' | 'error';
}

const FLOW_STEP_TEXT = {
  gate: ['prerequisites checked', 'المتطلبات جاهزة'],
  sent: ['prompt sent to chat', 'أُرسل الطلب إلى المحادثة'],
  running: ['agent turn running', 'دور الوكيل قيد التشغيل'],
  queued: ['queued behind the active chat turn', 'في الطابور خلف تشغيل المحادثة'],
  recorded: ['run recorded in flows store', 'سُجّل التشغيل في مخزن المسارات'],
  finished: ['run finished', 'انتهى التشغيل'],
} as const;
const fst = (key: keyof typeof FLOW_STEP_TEXT, ar: boolean): string => FLOW_STEP_TEXT[key][ar ? 1 : 0];

/** The five real steps, each with an honest state — never a fabricated progress bar. */
export function flowRunSteps(status: RunStatus, flags: FlowRunFlags = {}, ar = false): FlowRunStep[] {
  const finished = status === 'done' || status === 'error';
  return [
    { id: 'gate', label: fst('gate', ar), state: 'done' },
    { id: 'sent', label: fst('sent', ar), state: flags.sent ? 'done' : 'active' },
    {
      id: 'running',
      label: flags.queued && !flags.sent ? fst('queued', ar) : fst('running', ar),
      state: status === 'running' ? 'active' : finished ? 'done' : 'pending',
    },
    {
      id: 'recorded',
      label: fst('recorded', ar),
      state:
        flags.recordError || flags.noTurn || flags.timedOut
          ? 'error'
          : flags.recorded
            ? 'done'
            : 'pending',
    },
    {
      id: 'finished',
      label: fst('finished', ar),
      state: status === 'done' ? 'done' : status === 'error' ? 'error' : 'pending',
    },
  ];
}

/** Gate a run before it starts; returns the honest reason when it cannot. */
export function flowRunGate(
  flow: Flow,
  hasSession: boolean,
  wsPath: string,
  chatBusy: boolean,
  ar = false,
): { ok: boolean; reason?: string; queued: boolean; flowWs?: string } {
  if (!hasSession) {
    return { ok: false, queued: false, reason: ar ? 'لا توجد جلسة نشطة — أنشئ جلسة أولاً' : 'No active session — start one first' };
  }
  // v11.38 — a slash-prefixed string is a chat COMMAND, not a prompt turn.
  // store.sendMessage routes it to the command palette and never starts an
  // agent turn; recording it would be a false-done. Refuse it up front.
  if (flow.prompt.trim().startsWith('/')) {
    return {
      ok: false,
      queued: false,
      reason: ar
        ? 'طلب المسار يبدأ بـ «/» — هذا أمر محادثة ولن يُشغَّل كدور وكيل. أزل الرمز /.'
        : 'This flow prompt starts with “/” — that is a chat command, not a runnable agent turn. Remove the leading /.',
    };
  }
  const flowWs = flow.scope === 'workspace' ? wsPath.trim() : '';
  if (flow.scope === 'workspace' && !flowWs) {
    return { ok: false, queued: false, reason: ar ? 'افتح مساحة العمل أولاً' : 'Open a workspace first' };
  }
  // A global flow needs no workspace to be RECORDED; chat still needs a session.
  return { ok: true, queued: chatBusy, flowWs: flowWs || undefined };
}

/* ============================================================
   v11.38 — THE REAL RUN ORCHESTRATOR (framework-neutral).

   WHY THIS EXISTS (the gap D9 missed): `kdx:agent:run`
   (electron/agent/register.ts:542) calls runAgent() fire-and-forget, so
   `store.sendMessage()` resolves as soon as the turn is *launched*, NOT when
   it settles. The old FlowsPanel only waited when the chat was ALREADY busy at
   click time — in the normal idle case it recorded the run (and printed five
   green steps) BEFORE the prompt reached the provider. That is a false-done.

   This orchestrator watches the actual `running` edge from the store and
   records ONLY after a real false→true→false turn settles. If sendMessage
   returns without starting a turn (no model / no session / a slash command),
   it records nothing and returns an honest `no-turn` reason. All I/O is injected
   so the whole path is unit-testable with local temp state — no React needed.
   ============================================================ */

export type FlowRunReason =
  | 'ok'
  | 'send-failed'
  | 'no-turn'
  | 'timeout'
  | 'record-failed';

export interface FlowRunDeps {
  /** The real chat send path (store.sendMessage) — sends the prompt verbatim. */
  send: (text: string) => Promise<void>;
  /** Live `running` flag from the store. */
  isRunning: () => boolean;
  /** Subscribe to `running` changes; returns an unsubscribe function. */
  subscribe: (cb: (running: boolean) => void) => () => void;
  /** Record a settled run through the flows bridge. Resolves true on success. */
  record: (id: string, ws?: string) => Promise<boolean>;
  /** Workspace key for workspace-scoped flows. */
  ws?: string;
  /** Injectable clock/timer for deterministic tests. */
  now?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  timeoutMs?: number;
}

export interface FlowRunOutcome {
  reason: FlowRunReason;
  /** True only when a real turn settled AND the store recorded the run. */
  ok: boolean;
  sent: boolean;
  settled: boolean;
  recorded: boolean;
  startedAt: number;
  settledAt?: number;
  detail?: string;
}

export async function executeFlowRun(flow: Flow, deps: FlowRunDeps): Promise<FlowRunOutcome> {
  const now = deps.now ?? Date.now;
  const setTimer =
    deps.setTimeoutFn ??
    ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);
  const clearTimer =
    deps.clearTimeoutFn ??
    ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const timeoutMs = deps.timeoutMs ?? 120_000;
  const startedAt = now();

  // `running:true` at click time = a queued run behind an active turn.
  let started = deps.isRunning();
  let settled = false;
  let settledAt: number | undefined;
  let wake: (() => void) | null = null;
  let unsub: () => void = () => {};
  let timer: unknown = null;

  const onRunning = (running: boolean): void => {
    if (running) {
      started = true;
    } else if (started && !settled) {
      settled = true;
      settledAt = now();
      if (wake) {
        wake();
        wake = null;
      }
    }
  };
  // Subscribe BEFORE sending so a fast turn cannot slip past the watcher.
  unsub = deps.subscribe(onRunning);

  let sent = false;
  let sendError: unknown = null;
  try {
    await deps.send(flow.prompt);
    sent = true;
  } catch (err) {
    sendError = err;
  }
  // Defensive re-read in case a host does not notify on every state change.
  if (deps.isRunning()) started = true;

  let reason: FlowRunReason = 'ok';
  if (sendError) {
    reason = 'send-failed';
  } else if (!started) {
    // sendMessage bailed before starting any turn — nothing actually ran.
    reason = 'no-turn';
  } else if (!settled) {
    // Wait for the real running:true → false edge, hard-bounded.
    const wait = new Promise<void>((resolve) => {
      wake = resolve;
    });
    timer = setTimer(() => {
      if (wake) {
        wake();
        wake = null;
      }
    }, timeoutMs);
    await wait;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    reason = settled ? 'ok' : 'timeout';
  }
  unsub();
  unsub = () => {};

  let recorded = false;
  if (reason === 'ok') {
    try {
      recorded = (await deps.record(flow.id, deps.ws)) === true;
    } catch {
      recorded = false;
    }
    if (!recorded) reason = 'record-failed';
  }

  return {
    reason,
    ok: reason === 'ok' && recorded,
    sent,
    settled,
    recorded,
    startedAt,
    ...(settledAt !== undefined ? { settledAt } : {}),
    ...(sendError ? { detail: String(sendError) } : {}),
  };
}

/** Compact relative time (same grammar as DnaPanel/WorkspacePanel). */
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

/* Engraved loop glyph — one exact circle, one 300° sweep, one arrowhead.
 * The end point AND both barbs are computed from the circle's tangent, so
 * the head sits at a calculated point instead of an eyeballed one. */
const LOOP_CX = 20;
const LOOP_CY = 20;
const LOOP_R = 13;
const loopPolar = (r: number, a: number) =>
  [LOOP_CX + Math.cos(a) * r, LOOP_CY + Math.sin(a) * r] as const;
const loopP = (x: number, y: number) => `${x.toFixed(2)} ${y.toFixed(2)}`;

function FlowLoopGlyph() {
  const a0 = -Math.PI / 2; // 12 o'clock
  const a1 = a0 + (300 * Math.PI) / 180; // clockwise, large arc
  const [ex, ey] = loopPolar(LOOP_R, a1);
  // Unit tangent for an increasing angle at the endpoint: (-sin a, cos a).
  const tx = -Math.sin(a1);
  const ty = Math.cos(a1);
  // Perpendicular to the tangent; barbs are set back -T and fanned ±half.
  const nx = ty;
  const ny = -tx;
  const back = 3.7;
  const half = 2.15;
  const b1x = ex - back * tx + half * nx;
  const b1y = ey - back * ty + half * ny;
  const b2x = ex - back * tx - half * nx;
  const b2y = ey - back * ty - half * ny;
  const [sx, sy] = loopPolar(LOOP_R, a0);
  return (
    <svg className="fl-glyph" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx={LOOP_CX} cy={LOOP_CY} r={LOOP_R} fill="none" stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <path
        d={`M${loopP(sx, sy)}A${LOOP_R} ${LOOP_R} 0 1 1 ${loopP(ex, ey)}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={`M${loopP(b1x, b1y)}L${loopP(ex, ey)}L${loopP(b2x, b2y)}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={LOOP_CX} cy={LOOP_CY} r="1.6" fill="currentColor" />
    </svg>
  );
}

/** Registration crosshair — the small engraved corner mark used by the site. */
function Crosshair({ corner }: { corner: 'tl' | 'br' }) {
  return (
    <svg className={`fl-cross fl-cross--${corner}`} viewBox="0 0 26 26" aria-hidden="true">
      <path d="M1 9 V1 H9" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <path d="M17 25 H25 V17" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <circle cx="13" cy="13" r="2" fill="var(--acc)" />
    </svg>
  );
}

/**
 * Empty-state art: a fine engraved loop with one link missing. The broken
 * segment is drawn as a quiet dashed bridge — the flow is not "broken", it
 * simply has not been chained yet.
 */
function FlowLoopEmptyArt() {
  return (
    <svg className="fl-empty-art" viewBox="0 0 220 120" aria-hidden="true">
      <g fill="none" stroke="var(--line-soft)" strokeWidth="1">
        <path d="M16 60 H204" strokeDasharray="2 6" />
        <path d="M110 10 V110" strokeDasharray="2 6" />
        <circle cx="110" cy="60" r="42" strokeDasharray="1 7" />
      </g>
      <g fill="none" stroke="var(--line-strong)" strokeWidth="1.4" strokeLinecap="round" vectorEffect="non-scaling-stroke">
        <path d="M149.5 45.7 A42 42 0 1 0 149.5 74.3" />
        <path d="M144.4 45.9 L150.6 45.6 L148.9 51.7" stroke="var(--acc)" />
      </g>
      {/* the missing link: two open ends + a dashed, unresolved bridge */}
      <g fill="none" stroke="var(--acc)" strokeWidth="1">
        <circle cx="149.5" cy="45.7" r="3.1" />
        <circle cx="149.5" cy="74.3" r="3.1" />
        <path d="M149.5 48.8 V71.2" strokeDasharray="2 5" opacity="0.55" />
      </g>
      <g fill="var(--faint)">
        <circle cx="16" cy="60" r="1.6" />
        <circle cx="204" cy="60" r="1.6" />
        <circle cx="110" cy="10" r="1.6" />
        <circle cx="110" cy="110" r="1.6" />
      </g>
    </svg>
  );
}

/**
 * Honest micro-sparkline of runs SEEN IN THIS SESSION. The backend stores
 * runCount/lastRun only — it does not persist a per-run timeline — so with no
 * local events we draw a quiet flat hairline and say so in the title. With
 * events, the plotted series is the REAL measured spacing between consecutive
 * runs (seconds): the y-domain starts at a true 0 baseline and is scaled to
 * the largest observed gap, with a hairline axis and min/max ticks.
 */
const SPARK_W = 42;
const SPARK_H = 18;
const SPARK_PAD_X = 2;
const SPARK_PAD_Y = 3;

function Sparkline({ times, note }: { times: number[]; note: string }) {
  const pts = times.slice(-12);
  if (pts.length < 2) {
    return (
      <span className="fl-spark-flat" title={note} aria-label={note}>
        <span className="fl-spark-flat-dot" />
      </span>
    );
  }
  // Real session data: inter-run gaps in seconds (never fabricated noise).
  const gaps = pts.slice(1).map((t, i) => Math.max(0, (t - pts[i]) / 1000));
  const n = gaps.length;
  const max = Math.max(...gaps);
  const span = max || 1;
  const plotW = SPARK_W - SPARK_PAD_X * 2;
  const plotH = SPARK_H - SPARK_PAD_Y * 2;
  const xAt = (i: number) => SPARK_PAD_X + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => SPARK_PAD_Y + plotH - (v / span) * plotH;
  const points = gaps.map((v, i) => `${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`).join(' ');
  const top = SPARK_PAD_Y;
  const base = SPARK_H - SPARK_PAD_Y;
  const lastX = xAt(n - 1);
  const lastY = yAt(gaps[n - 1]);
  return (
    <span className="fl-spark-wrap" title={note} aria-label={note}>
      <svg className="fl-spark" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" aria-hidden="true">
        <line className="fl-spark-grid" x1="0" y1={top} x2={SPARK_W} y2={top} vectorEffect="non-scaling-stroke" />
        <line className="fl-spark-axis" x1="0" y1={base} x2={SPARK_W} y2={base} vectorEffect="non-scaling-stroke" />
        <path className="fl-spark-tick" d={`M0 ${top}h3M0 ${base}h3`} vectorEffect="non-scaling-stroke" />
        <polyline points={points} vectorEffect="non-scaling-stroke" />
        <circle className="fl-spark-dot" cx={lastX} cy={lastY} r="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}

/** The real run path, step by step — honest states, no invented progress %. */
function RunStepsView({ steps }: { steps: FlowRunStep[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-2.5 py-1.5 border-t border-line" aria-label="flow run steps">
      {steps.map((s) => (
        <span
          key={s.id}
          className={`inline-flex items-center gap-1 text-[9px] ${
            s.state === 'error' ? 'text-[var(--warn)]' : s.state === 'done' ? 'text-[var(--ok)]' : 'text-faint'
          }`}
          data-step={s.id}
          data-state={s.state}
          title={s.label}
        >
          <span aria-hidden="true" className="inline-flex items-center">
            {s.state === 'done' ? <Check size={9} /> : s.state === 'error' ? <X size={9} /> : <span className="fl-status-queued" />}
          </span>
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Inline, non-triumphal run feedback. 'done' means the chat run finished. */
function RunStatusView({ status, label }: { status: RunStatus; label: string }) {
  return (
    <div className="fl-status" data-status={status} role="status" aria-live="polite">
      <span className="fl-status-line" aria-hidden="true" />
      <span className="fl-status-dot" aria-hidden="true">
        {status === 'done' ? (
          <Check size={11} />
        ) : status === 'error' ? (
          <X size={11} />
        ) : status === 'running' ? (
          <Spinner size={11} />
        ) : (
          <span className="fl-status-queued" />
        )}
      </span>
      <span className="fl-status-text">{label}</span>
    </div>
  );
}

export function FlowsPanel({ embedded }: { embedded?: boolean }) {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const ar = lang === 'ar';
  const wsPath = useStore((s) => s.wsPath);
  const hasSession = useStore((s) => s.session !== null);
  const sendMessage = useStore((s) => s.sendMessage);
  const notify = useStore((s) => s.notify);

  const [flows, setFlows] = useState<Flow[] | null>(null); // null = loading
  const [editor, setEditor] = useState<FlowDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  // run-count overlay — only bumped AFTER the backend recorded the run
  const [runBumps, setRunBumps] = useState<Record<string, number>>({});
  // v11.36 — per-flow real-step flags (sent / queued / recorded)
  const [runFlags, setRunFlags] = useState<Record<string, FlowRunFlags>>({});
  // honest local bookkeeping — the store keeps no per-run timeline
  const [runHistory, setRunHistory] = useState<Record<string, number[]>>({});
  const [runAt, setRunAt] = useState<Record<string, number>>({});
  const [runStatus, setRunStatus] = useState<Record<string, RunStatus>>({});
  // v11.38 — REAL repetition suggestions read from the hit store through the
  // existing flowsInfo bridge (no new preload method required).
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // refs guard against two clicks landing in the same render frame (the
  // state-only `runningId` guard was stale until React re-rendered).
  const runningRef = useRef<string | null>(null);

  /** Re-read both the flow list and the honest suggestion summary from disk. */
  const load = useCallback((): Promise<void> => {
    try {
      return Promise.all([
        flowsApi
          // v14 — pass wsPath so workspace-scoped flows are actually listed.
          .flowsList?.(wsPath || undefined)
          .then((list) => setFlows(Array.isArray(list) ? list : []))
          .catch(() => setFlows([])),
        flowsApi
          .flowsInfo?.(wsPath || undefined)
          .then((info) => setSuggestions(Array.isArray(info?.suggestionTexts) ? info.suggestionTexts : []))
          .catch(() => setSuggestions([])),
      ]).then(() => undefined);
    } catch {
      setFlows([]); // older preload — graceful empty state
      return Promise.resolve();
    }
  }, [wsPath]);

  // rail views mount on activation — load on mount, refresh after mutations
  useEffect(() => {
    load();
  }, [load]);

  const startNew = () => {
    setValidation(null);
    setEditor({ name: '', prompt: '', scope: wsPath ? 'workspace' : 'global' });
  };
  /** Open the editor with the EXACT repeated prompt (never the normalized key). */
  const saveSuggestion = (raw: string) => {
    setValidation(null);
    setEditor({
      name: raw.replace(/\s+/g, ' ').trim().slice(0, 40),
      prompt: raw,
      scope: wsPath ? 'workspace' : 'global',
    });
  };
  const startEdit = (f: Flow) => {
    setValidation(null);
    setEditor({ id: f.id, name: f.name, prompt: f.prompt, scope: f.scope });
  };
  const cancelEditor = () => {
    setValidation(null);
    setEditor(null);
  };

  /** Honest inline validation — no silent truncated saves. */
  const validateEditor = (d: FlowDraft): string | null => {
    const name = d.name.trim();
    const prompt = d.prompt.trim();
    if (!name) return t('flows.val.name', ar ? 'أدخل اسماً للمسار.' : 'Give the flow a name.');
    if (name.length > 80) return t('flows.val.nameLen', ar ? 'الاسم طويل جداً (80 حرفاً كحد أقصى).' : 'Name is too long (80 characters max).');
    if (!prompt) return t('flows.val.prompt', ar ? 'اكتب الطلب الذي سيرسله المسار.' : 'Write the prompt this flow will send.');
    if (prompt.length > 20000)
      return t('flows.val.promptLen', ar ? 'الطلب طويل جداً (20 ألف حرف كحد أقصى).' : 'Prompt is too long (20,000 characters max).');
    const dup = (flows ?? []).some((f) => f.name.trim().toLowerCase() === name.toLowerCase() && f.id !== d.id);
    return dup ? t('flows.duplicate') : null;
  };

  const saveEditor = async () => {
    if (!editor || saving) return;
    const err = validateEditor(editor);
    if (err) {
      setValidation(err);
      notify(err);
      return;
    }
    const name = editor.name.trim();
    const prompt = editor.prompt.trim();
    setSaving(true);
    try {
      const list = await flowsApi.flowsSave?.({ id: editor.id, name, prompt, scope: editor.scope }, wsPath || undefined);
      // A guarded/absent bridge returns undefined — never claim "saved" when
      // nothing was persisted. Re-read from disk to confirm the write landed.
      if (!Array.isArray(list)) {
        const refreshed = await flowsApi.flowsList?.(wsPath || undefined).catch(() => null);
        if (!Array.isArray(refreshed)) throw new Error('flows bridge unavailable');
        setFlows(refreshed);
      } else {
        setFlows(list);
      }
      notify(t(editor.id ? 'flows.updated' : 'flows.saved'));
      setValidation(null);
      setEditor(null);
    } catch {
      const msg = t('misc.error', 'Something went wrong');
      setValidation(msg);
      notify(msg);
    } finally {
      setSaving(false);
    }
  };

  const remove = (f: Flow) => {
    if (!window.confirm(t('flows.confirmDelete'))) return;
    try {
      void flowsApi
        .flowsDelete?.(f.id, wsPath || undefined)
        .then((list) => {
          setFlows(Array.isArray(list) ? list : []);
          setRunBumps((b) => {
            const next = { ...b };
            delete next[f.id];
            return next;
          });
          setRunHistory((h) => {
            const next = { ...h };
            delete next[f.id];
            return next;
          });
          setRunStatus((s) => {
            const next = { ...s };
            delete next[f.id];
            return next;
          });
          setRunFlags((s) => {
            const next = { ...s };
            delete next[f.id];
            return next;
          });
          notify(t('flows.deleted'));
        })
        .catch(() => notify(t('misc.error', 'Something went wrong')));
    } catch {
      notify(t('misc.error', 'Something went wrong'));
    }
  };

  /** Copy the exact prompt — no rewriting, no invented variables. Works in
   *  insecure contexts too (clipboard API absent): falls back to execCommand. */
  const copyPrompt = (f: Flow) => {
    void (async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(f.prompt);
        } else {
          const ta = document.createElement('textarea');
          ta.value = f.prompt;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand('copy');
          ta.remove();
          if (!ok) throw new Error('copy rejected');
        }
        notify(t('flows.copy.ok', ar ? 'تم نسخ الطلب' : 'Prompt copied'));
      } catch {
        notify(t('misc.error', 'Something went wrong'));
      }
    })();
  };

  /** Honest reason text for a run that could not be recorded. */
  const runFailureText = (reason: FlowRunReason): string => {
    switch (reason) {
      case 'send-failed':
        return t('misc.error', ar ? 'أخفق إرسال الطلب إلى المحادثة.' : 'The prompt could not be sent to chat.');
      case 'no-turn':
        return t(
          'flows.run.noTurn',
          ar
            ? 'لم يبدأ أي دور في المحادثة — تحقق من إعداد النموذج والجلسة. لم يُسجَّل تشغيل.'
            : 'No chat turn started — check the model and session setup. Nothing was recorded.',
        );
      case 'timeout':
        return t(
          'flows.run.timeout',
          ar
            ? 'لم ينتهِ دور المحادثة في الوقت المحدد — لم يُسجَّل تشغيل.'
            : 'The chat turn did not settle in time — nothing was recorded.',
        );
      case 'record-failed':
        return t(
          'flows.ranNotRecorded',
          ar ? 'انتهى التشغيل — تعذّر تسجيله في مخزن المسارات' : 'Run finished but could not be recorded',
        );
      default:
        return t('misc.error', 'Something went wrong');
    }
  };

  /**
   * v11.42 — ONE primary action. Run = send the exact stored prompt through the
   * normal chat path, watch the REAL `running` edge, and record ONLY after the
   * turn settles. The old "Replay" icon was a second button doing the exact
   * same thing (only the toast text differed) — a dead control that made the
   * feature look like two unrelated operations. Pressing Run again IS replay.
   */
  const runFlow = async (f: Flow): Promise<void> => {
    if (runningRef.current) return; // ref guard: state was stale within the click frame
    const gate = flowRunGate(f, hasSession, wsPath || '', useStore.getState().running, ar);
    if (!gate.ok) {
      if (gate.reason) notify(gate.reason);
      return;
    }
    const startedAt = Date.now();
    runningRef.current = f.id;
    setRunningId(f.id);
    setRunStatus((s) => ({ ...s, [f.id]: gate.queued ? 'queued' : 'running' }));
    setRunFlags((s) => ({
      ...s,
      [f.id]: { sent: false, queued: gate.queued, recorded: false },
    }));
    setRunAt((a) => ({ ...a, [f.id]: startedAt }));
    setRunHistory((h) => ({ ...h, [f.id]: [...(h[f.id] ?? []), startedAt].slice(-12) }));
    // one frame of "queued" so the drawn-in status hairline is visible
    queueMicrotask(() =>
      setRunStatus((s) => (s[f.id] === 'queued' ? { ...s, [f.id]: 'running' } : s)),
    );

    const outcome = await executeFlowRun(f, {
      send: (text) => sendMessage(text),
      isRunning: () => useStore.getState().running,
      subscribe: (cb) => useStore.subscribe((s) => cb(s.running)),
      record: async (id, ws) => {
        try {
          return (await flowsApi.flowsMarkRun?.(id, ws)) === true;
        } catch {
          return false;
        }
      },
      ws: gate.flowWs,
    });

    setRunFlags((s) => ({
      ...s,
      [f.id]: {
        ...(s[f.id] ?? {}),
        sent: outcome.sent,
        settled: outcome.settled,
        recorded: outcome.recorded,
        recordError: outcome.reason === 'record-failed',
        noTurn: outcome.reason === 'no-turn',
        timedOut: outcome.reason === 'timeout',
      },
    }));

    if (outcome.ok) {
      // Optimistic overlay only until the authoritative disk read lands.
      setRunBumps((b) => ({ ...b, [f.id]: (b[f.id] ?? f.runCount) + 1 }));
      void load().finally(() =>
        setRunBumps((b) => {
          const next = { ...b };
          delete next[f.id];
          return next;
        }),
      );
      setRunStatus((s) => ({ ...s, [f.id]: 'done' }));
      // v11.42 — the turn has already SETTLED here; "Flow started" (the old
      // flows.ranToast dictionary value) would be a false, late label.
      notify(t('flows.run.finished', ar
        ? 'اكتمل تشغيل المسار وسُجّل'
        : 'Flow finished — run recorded'));
    } else {
      setRunStatus((s) => ({ ...s, [f.id]: 'error' }));
      notify(runFailureText(outcome.reason));
    }
    runningRef.current = null;
    setRunningId(null);
  };

  const run = (f: Flow): Promise<void> => runFlow(f);

  /** Honest, persistent gate note: why a Run click cannot do anything yet. */
  const needsWorkspace = (flows ?? []).some((f) => f.scope === 'workspace');
  const gateNote = !hasSession
    ? t(
        'flows.gate.session',
        ar
          ? 'لا توجد جلسة نشطة — المسار يُرسل طلبه داخل محادثة. أنشئ جلسة ثم شغّل المسار.'
          : 'No active session — a flow sends its prompt inside a chat session. Start one first.',
      )
    : needsWorkspace && !wsPath
      ? t(
          'flows.gate.workspace',
          ar
            ? 'بعض المسارات مخصّصة لمشروع واحد — افتح مساحة العمل لتشغيلها.'
            : 'Some flows are workspace-scoped — open a workspace to run them.',
        )
      : null;

  const scopeChip = (scope: Flow['scope']) => (
    <span className={`fl-scope ${scope === 'workspace' ? 'is-ws' : ''}`} title={t('flows.scope')}>
      {scope === 'workspace' ? <Folder size={9} /> : <Globe size={9} />}
      {t(scope === 'workspace' ? 'flows.scope.workspace' : 'flows.scope.global')}
    </span>
  );

  const statusLabel = (id: string): string => {
    switch (runStatus[id]) {
      case 'queued':
        return t('flows.status.queued', ar ? 'في طابور المحادثة' : 'queued in chat');
      case 'running':
        return t('flows.status.running', ar ? 'قيد التشغيل في المحادثة' : 'running in chat');
      case 'done':
        return t('flows.status.done', ar ? 'انتهى تشغيل المحادثة' : 'chat run finished');
      case 'error':
        return t('flows.status.error', ar ? 'فشل الإرسال' : 'send failed');
      default:
        return '';
    }
  };

  const sparkNote = t(
    'flows.spark.note',
    ar
      ? 'المسافة الزمنية بين تشغيلات هذه الجلسة فقط — لا يُحفظ سجل دائم لكل تشغيل.'
      : 'spacing between this session’s runs only — no per-run timeline is stored',
  );

  return (
    <div
      className={`fl-root fl-page page-v14 p-3 flex flex-col gap-3 overflow-y-auto min-h-0 ${embedded ? 'is-embedded flex-1' : 'h-full'}`}
    >
      {/* ---------- editorial page head ---------- */}
      <div className="fl-head pv14-head fl-reveal" style={{ ['--i' as string]: 0 }}>
        <FlowLoopGlyph />
        <div className="fl-head-copy pv14-head-copy">
          <span className="pv14-eyebrow">05 / FLOWS</span>
          <h2 className="fl-display">{t('flows.title')}</h2>
          <p className="pv14-desc fl-lede">
            {t(
              'flows.lede',
              ar
                ? 'المسار طلب محفوظ يُعاد إرساله في المحادثة بضغطة واحدة — ليس مهمة تعمل تلقائياً.'
                : 'A flow is a saved prompt, re-sent in chat with one click — not an autonomous job.',
            )}
          </p>
        </div>
        <div className="pv14-head-actions fl-head-actions">
          <span className="fl-count" dir="ltr">
            {flows ? String(flows.length).padStart(2, '0') : '··'}
          </span>
          <Btn
            variant="primary"
            className="fl-new focus-glass"
            onClick={startNew}
            disabled={editor !== null}
            title={t('flows.new')}
          >
            <Plus size={13} />
            {t('flows.new')}
          </Btn>
        </div>
      </div>

      {/* ---------- the founder's recurring question, answered on the page ---------- */}
      <section className="fl-compare fl-reveal" style={{ ['--i' as string]: 1 }} aria-label={t('flows.compare.title', ar ? 'المسارات مقابل المهام المجدولة' : 'Flows vs Scheduled Jobs')}>
        <Crosshair corner="tl" />
        <Crosshair corner="br" />
        <div className="fl-compare-col">
          <span className="fl-compare-kicker">A — INTERACTIVE</span>
          <h3 className="fl-compare-title">{t('flows.compare.flow', ar ? 'مسار (Flow)' : 'Flow')}</h3>
          <p className="fl-compare-body">
            {t(
              'flows.compare.flowBody',
              ar
                ? 'اختصار تفاعلي داخل المحادثة. أنت من يضغط Run: يُعاد إرسال الطلب المحفوظ كما كُتب، ويجيب الوكيل داخل جلستك الحالية.'
                : 'An interactive shortcut in chat. You press Run: the saved prompt is re-sent exactly as written and the agent answers inside your current session.',
            )}
          </p>
        </div>
        <div className="fl-compare-col">
          <span className="fl-compare-kicker">B — AUTONOMOUS</span>
          <h3 className="fl-compare-title">{t('flows.compare.job', ar ? 'مهمة مجدولة' : 'Scheduled job')}</h3>
          <p className="fl-compare-body">
            {t(
              'flows.compare.jobBody',
              ar
                ? 'عامل cron يعمل وحده حسب جدول زمني، في الخلفية، ويجب أن يجتاز بوابة الإثبات قبل أن يُعدَّ ناجحاً.'
                : 'A cron worker that fires on a schedule, runs in the background, and must pass the proof gate before it counts as done.',
            )}
          </p>
        </div>
        <div className="fl-compare-note">
          <span className="fl-rule-art" aria-hidden="true" />
          {t('flows.compare.note', ar ? 'المسار لا يعمل من تلقاء نفسه — أنت من يبدأه.' : 'A flow never runs by itself — you start it.')}
        </div>
      </section>

      {/* ---------- v11.42 — the PURPOSE, in three honest steps ----------
          The founder's rule: "the feature must be genuinely useful, not dumb."
          A flow is only useful if the user can see, without thinking, why it
          exists: repeat a prompt → save it → press one Run button. No invented
          progress, no autonomous claims — exactly what the code really does. */}
      <section className="fl-how fl-reveal" style={{ ['--i' as string]: 2 }} aria-label={t('flows.how.title', ar ? 'كيف يعمل المسار' : 'How a flow works')}>
        <div className="fl-list-title">
          <span className="micro-label">{t('flows.how.title', ar ? 'كيف يعمل المسار' : 'HOW A FLOW WORKS')}</span>
          <span className="fl-list-rule" aria-hidden="true" />
        </div>
        <ol className="flex flex-wrap gap-x-6 gap-y-1.5 m-0 p-0 list-none text-[11.5px] leading-relaxed text-dim">
          <li className="flex items-baseline gap-1.5">
            <span className="tnum text-acc shrink-0" dir="ltr">01</span>
            <span>{t('flows.how.s1', ar
              ? 'اكتب الطلب نفسه عدة مرات — يظهر تحت «الطلبات المتكررة».'
              : 'Type the same prompt a few times — it appears under “Repeated prompts”.')}</span>
          </li>
          <li className="flex items-baseline gap-1.5">
            <span className="tnum text-acc shrink-0" dir="ltr">02</span>
            <span>{t('flows.how.s2', ar
              ? 'احفظه كمسار باسم واضح (عام أو لهذا المشروع).'
              : 'Save it as a named flow (global or this project only).')}</span>
          </li>
          <li className="flex items-baseline gap-1.5">
            <span className="tnum text-acc shrink-0" dir="ltr">03</span>
            <span>{t('flows.how.s3', ar
              ? 'اضغط Run: يُرسل النص الحرفي في محادثتك، ويُسجَّل التشغيل بعد انتهاء الدور فقط.'
              : 'Press Run: the exact text runs in your chat, and the run is recorded only after the turn finishes.')}</span>
          </li>
        </ol>
      </section>

      {/* ---------- v11.38 honest gates + real repetition suggestions ---------- */}
      {gateNote && (
        <div className="fl-error fl-gate-note" role="status" aria-live="polite">
          <X size={12} aria-hidden="true" />
          <span>{gateNote}</span>
        </div>
      )}
      {suggestions.length > 0 && !editor && (
        <section className="fl-suggest" aria-label={t('flows.suggest.title')}>
          <div className="fl-list-title">
            <span className="micro-label">
              {t('flows.suggest.title', ar ? 'طلبات تتكرر' : 'REPEATED PROMPTS')}
            </span>
            <span className="fl-list-rule" aria-hidden="true" />
            <span className="fl-list-count" dir="ltr">{String(suggestions.length).padStart(2, '0')}</span>
          </div>
          <p className="fl-hint">
            {t(
              'flows.suggest.body',
              ar
                ? 'كتبت هذه الطلبات عدة مرات. احفظ أياً منها كمسار لتشغيله بضغطة واحدة.'
                : 'You have typed these prompts several times. Save one as a one-click flow.',
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((raw) => (
              <button
                key={raw}
                type="button"
                className="fl-seg-btn press focus-glass"
                onClick={() => saveSuggestion(raw)}
                title={raw}
              >
                <Plus size={10} />
                <span className="max-w-[180px] truncate">{raw}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---------- inline editor (quiet inset panel) ---------- */}
      {editor && (
        <div className="fl-editor fl-reveal" aria-label={editor.id ? t('flows.edit') : t('flows.new')}>
          <div className="fl-editor-head">
            <span className="fl-editor-title">
              {t('flows.editor.kicker', ar ? 'محرر المسار' : 'FLOW EDITOR')} — {editor.id ? t('flows.edit') : t('flows.new')}
            </span>
            <IconBtn title={t('flows.cancel')} aria-label={t('flows.cancel')} onClick={cancelEditor}>
              <X size={12} />
            </IconBtn>
          </div>

          <label className="fl-label" htmlFor="fl-name-input">
            {t('flows.name')}
          </label>
          <input
            id="fl-name-input"
            className="fl-input"
            dir="auto"
            value={editor.name}
            placeholder={t('flows.namePh')}
            maxLength={80}
            onChange={(e) => {
              setValidation(null);
              setEditor({ ...editor, name: e.target.value });
            }}
          />

          <label className="fl-label" htmlFor="fl-prompt-input">
            {t('flows.prompt')}
          </label>
          <textarea
            id="fl-prompt-input"
            className="fl-textarea fl-mono-input"
            dir="auto"
            rows={5}
            value={editor.prompt}
            placeholder={t('flows.promptPh')}
            onChange={(e) => {
              setValidation(null);
              setEditor({ ...editor, prompt: e.target.value });
            }}
          />

          <p className="fl-hint">
            {t(
              'flows.vars.hint',
              ar
                ? 'لا يوجد محرك متغيرات: يُرسل هذا النص حرفياً. أي شيء داخل {{قوسين}} يبقى كما هو.'
                : 'No variable engine: this text is sent verbatim. Anything in {{braces}} stays literal.',
            )}
          </p>

          <div className="fl-preview">
            <div className="fl-preview-head">
              <span>{t('flows.preview.title', ar ? 'معاينة الإرسال' : 'INVOCATION PREVIEW')}</span>
              <span className="fl-preview-mark" aria-hidden="true">›_</span>
            </div>
            <pre dir="auto">
              {editor.prompt.trim() ||
                t('flows.preview.empty', ar ? 'اكتب طلباً لترى ما سيُرسل بالضبط.' : 'Write a prompt to see exactly what will be sent.')}
            </pre>
          </div>

          <div className="fl-label">{t('flows.scope')}</div>
          <div className="fl-seg" role="group" aria-label={t('flows.scope')}>
            <button
              type="button"
              className={`fl-seg-btn press focus-glass ${editor.scope === 'global' ? 'is-on' : ''}`}
              aria-pressed={editor.scope === 'global'}
              onClick={() => setEditor({ ...editor, scope: 'global' })}
            >
              <Globe size={11} />
              {t('flows.scope.global')}
            </button>
            <button
              type="button"
              className={`fl-seg-btn press focus-glass ${editor.scope === 'workspace' ? 'is-on' : ''}`}
              aria-pressed={editor.scope === 'workspace'}
              onClick={() => setEditor({ ...editor, scope: 'workspace' })}
            >
              <Folder size={11} />
              {t('flows.scope.workspace')}
            </button>
          </div>

          {validation && (
            <div className="fl-error" role="alert">
              <X size={12} aria-hidden="true" />
              <span>{validation}</span>
            </div>
          )}

          <div className="fl-editor-foot">
            <Btn
              variant="primary"
              className="focus-glass !h-7 !text-[11px]"
              disabled={saving || !editor.name.trim() || !editor.prompt.trim()}
              onClick={() => void saveEditor()}
            >
              {saving ? <Spinner size={12} /> : null}
              {t('flows.save')}
            </Btn>
            <Btn className="!h-7 !text-[11px]" onClick={cancelEditor}>
              {t('flows.cancel')}
            </Btn>
          </div>
        </div>
      )}

      {/* ---------- the list: hairline rows, not cards ---------- */}
      {flows !== null && flows.length > 0 && (
        <section className="fl-list-section fl-reveal" style={{ ['--i' as string]: 3 }}>
          <div className="fl-list-title">
            <span className="micro-label">{t('flows.list.title', ar ? 'المسارات المحفوظة' : 'SAVED FLOWS')}</span>
            <span className="fl-list-rule" aria-hidden="true" />
            <span className="fl-list-count" dir="ltr">{String(flows.length).padStart(2, '0')}</span>
          </div>
          <div className="fl-list">
            {flows.map((f, i) => {
              const runs = runBumps[f.id] ?? f.runCount;
              const last = Math.max(f.lastRun ?? 0, runAt[f.id] ?? 0);
              const status = runStatus[f.id];
              return (
                <div key={f.id} className={`fl-row ${runningId === f.id ? 'is-running' : ''}`}>
                  <span className="fl-idx" dir="ltr">{String(i + 1).padStart(2, '0')}</span>

                  <div className="fl-row-main">
                    <div className="fl-row-name">
                      {runs > 0 && <span className="fl-breathe" title={t('flows.active', ar ? 'شُغّل من قبل' : 'has been run')} aria-hidden="true" />}
                      <span className="fl-name" dir="auto" title={f.name}>
                        {f.name}
                      </span>
                    </div>
                    {scopeChip(f.scope)}
                  </div>

                  <div className="fl-prompt" dir="auto" title={f.prompt}>
                    {f.prompt}
                  </div>

                  <div className="fl-runs-cell" dir="ltr">
                    <span className="fl-runs-num">{runs}</span>
                    <span className="fl-runs-label">{t('flows.runs')}</span>
                    <Sparkline times={runHistory[f.id] ?? []} note={sparkNote} />
                  </div>

                  <div className="fl-last" dir="auto">
                    {t('flows.lastRun')}: {last ? relTime(last, lang) : t('flows.never')}
                  </div>

                  <div className="fl-row-actions">
                    {/* v11.42 — the single PRIMARY action: Run. Re-pressing it
                        replays the exact stored prompt; a second "Replay" button
                        was a dead duplicate, so it is gone. */}
                    <button
                      type="button"
                      className="fl-btn fl-btn-run press focus-glass"
                      disabled={runningId === f.id}
                      onClick={() => void run(f)}
                      title={t('flows.run.title', ar
                        ? 'أرسل الطلب المحفوظ حرفياً في المحادثة، وسُجَّل التشغيل بعد انتهاء الدور.'
                        : 'Send the saved prompt verbatim in chat; the run is recorded when the turn finishes.')}
                      aria-label={t('flows.run.flow', ar ? 'شغّل المسار' : 'Run flow')}
                    >
                      {runningId === f.id ? <Spinner size={11} /> : <Play size={11} />}
                      {t('flows.run.flow', ar ? 'شغّل المسار' : 'Run flow')}
                    </button>
                    <IconBtn title={t('flows.copy', ar ? 'نسخ الطلب' : 'Copy prompt')} aria-label={t('flows.copy', ar ? 'نسخ الطلب' : 'Copy prompt')} onClick={() => copyPrompt(f)}>
                      <Copy size={12} />
                    </IconBtn>
                    <IconBtn title={t('flows.edit')} aria-label={t('flows.edit')} onClick={() => startEdit(f)}>
                      <Pencil size={12} />
                    </IconBtn>
                    <IconBtn title={t('flows.delete')} aria-label={t('flows.delete')} onClick={() => remove(f)}>
                      <Trash2 size={12} />
                    </IconBtn>
                  </div>

                  {status && (
                    <>
                      <RunStatusView
                        status={status}
                        label={`${t('flows.status.label', ar ? 'آخر إرسال' : 'LAST SEND')} · ${statusLabel(f.id)}`}
                      />
                      <RunStepsView steps={flowRunSteps(status, runFlags[f.id] ?? {}, ar)} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---------- loading ---------- */}
      {flows === null && (
        <div className="fl-skel" aria-label={t('misc.loading', 'Loading…')}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel-row skeleton-shimmer" style={{ height: 68 }} />
          ))}
        </div>
      )}

      {/* ---------- empty state: an engraved loop with a missing link ---------- */}
      {flows !== null && flows.length === 0 && !editor && (
        <section className="fl-empty fl-reveal" style={{ ['--i' as string]: 3 }}>
          <Crosshair corner="tl" />
          <Crosshair corner="br" />
          <FlowLoopEmptyArt />
          <h3 className="fl-empty-title">{t('flows.empty.title')}</h3>
          <p className="fl-empty-sub">{t('flows.empty.body')}</p>
          <Btn variant="primary" className="focus-glass fl-empty-cta" onClick={startNew}>
            <Plus size={13} />
            {t('flows.empty.cta', ar ? 'أنشئ مسارك الأول' : 'Create your first flow')}
          </Btn>
          {/* v11.42 — the old <kbd>⌘/Ctrl K</kbd> hint was a DEAD control: App.tsx
              maps that chord to the global command palette, not to a new flow.
              Show the real, honest next step instead. */}
          <div className="fl-empty-hint" role="note">
            {t('flows.empty.tip', ar
              ? 'نصيحة: اكتب نفس الطلب ٣ مرات وسيظهر مقترحاً في الأعلى.'
              : 'Tip: type the same prompt 3 times and it shows up as a suggestion above.')}
          </div>
        </section>
      )}
    </div>
  );
}

export default FlowsPanel;
