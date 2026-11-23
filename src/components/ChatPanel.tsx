// ChatPanel — AGENT CONSOLE (Aurora chat experience, agent B2). Compact
// header with the control cluster (recap · review · skills · compact · new ·
// sessions), the skills strip, the ProofRibbon + session timeline, the
// Aurora run PHASE STRIP (THINK · WORK · BUILD · RUN · PROVE, built from the
// real transcript + run clock) pinned above the message stream, phase-banded
// timeline bands (StreamTimeline) with slim MessageView instrument cards, the
// plan-approval contract, review findings, doom-loop / ask_user / write
// approval cards, starter prompts, and the floating Composer card.
import './chat.css';
import './console.css';
import './chat-final.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppWindow,
  ArrowDown,
  BookOpen,
  ChevronDown,
  Download,
  FileDown,
  FlaskConical,
  List,
  ListChecks,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  Minimize2,
  MoreHorizontal,
  PenLine,
  Repeat,
  ShieldAlert,
  ShieldCheck,
  Shrink,
  Trash2,
  Wrench,
  Monitor,
  FileText,
  PanelsTopLeft,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ChatMessage, ReviewFinding, TodoItem } from '../../shared/types';
import { useStore, CHAT_MIN, CHAT_MAX, CHAT_DEFAULT } from '../store';
import { PERMISSION_MODES, nextIn } from '../lib/modes';
import { api } from '../lib/api';
import { useT } from '../i18n';
import { Btn, Chip, IconBtn, Kbd, shortModel, TextInput } from './ui';
import { MessageView, TodoRows } from './MessageView';
import { AgentTeamCard } from './AgentTeamCard';
import { BAND_META, groupStreamBands, phaseOfTool, PROVE_ROW_MODELS, StreamBandShell } from './StreamTimeline';
import type { StreamPhase } from './StreamTimeline';
// v11.24 — the pure working-state helpers (stable phase-picked gerund / elapsed
// clock) from the unit-tested stream lib (src/lib/streamDisplay.ts). The live
// status glyph is an inline spinning-circle SVG; the Logo import below serves
// only the empty-state brand mark (never a live indicator).
import { formatElapsedClock, GERUND_EN, pickGerund } from '../lib/streamDisplay';
import type { GerundPhase } from '../lib/streamDisplay';
import { Composer, composerBridge } from './Composer';
import { GoalBanner } from './GoalBanner';
import { ProofRibbon } from './ProofRibbon';
import { SessionTimeline } from './SessionTimeline';
import { Logo } from './Logo';

// Stable empty-array for the pill's message selector (never re-created).
const NO_MESSAGES: ChatMessage[] = [];

// auto-scroll stickiness — the user counts as "at the bottom" within this
// many px of the edge; beyond it the stream detaches and the jump pill shows
const SCROLL_STICK_PX = 120;

// ---- rendered history cap (no virtualization) ----
// Only the LAST RENDER_WINDOW messages mount; the "load earlier" glass chip
// raises the window by RENDER_STEP. Tool-result pairing stays correct because
// resultById is built over the FULL array while only the window renders.
const RENDER_WINDOW = 100;
const RENDER_STEP = 200;

// ---- resizable chat panel — width is persisted via localStorage.
//
// v11.34 — the founder's right work area dominated the window: the store's
// hard CHAT_MAX (720px) capped the chat far below a monitor-width split. The
// panel now computes an *effective* max from the live viewport so the chat can
// reach ~80% of the window while the work area keeps a usable 280px floor.
// ChatPanel is the ONLY consumer of the numeric `chatWidth` slice, so a local
// override can safely carry widths beyond the store's legacy clamp.
const CHAT_WIDTH_KEY = 'surnia.chatWidth';
const WORK_MIN_PX = 280;
const CHAT_MAX_FRACTION = 0.8;
const CHAT_BALANCE_FRACTION = 0.55;

const viewportWidth = (): number =>
  typeof window === 'undefined' ? 0 : window.innerWidth || 0;

/** Largest sensible chat width: ~80% of the window, never below CHAT_MIN,
 *  and always leaving WORK_MIN_PX for the work area. */
export const effectiveChatMax = (): number => {
  const vw = viewportWidth();
  if (!vw) return CHAT_MAX;
  const cap = Math.min(Math.floor(vw * CHAT_MAX_FRACTION), vw - WORK_MIN_PX);
  return Math.max(CHAT_MIN, cap);
};

/** Double-click / Enter reset — a balanced 55/45 chat / work split. */
export const balancedChatWidth = (): number => {
  const vw = viewportWidth();
  if (!vw) return CHAT_DEFAULT;
  return Math.max(CHAT_MIN, Math.min(effectiveChatMax(), Math.round(vw * CHAT_BALANCE_FRACTION)));
};

/** Read the FULL persisted width — the store clamps it to CHAT_MAX on boot. */
function readFullChatWidth(): number {
  try {
    const n = Number(localStorage.getItem(CHAT_WIDTH_KEY));
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  } catch {
    /* storage unavailable */
  }
  return CHAT_DEFAULT;
}

/** Persist the raw width so a >CHAT_MAX drag survives a reload. */
function persistFullChatWidth(px: number): void {
  try {
    localStorage.setItem(CHAT_WIDTH_KEY, String(px));
  } catch {
    /* storage unavailable */
  }
}

// ---------------- v2.2 DNA suggestion chip (repeated workflow → skill) ----------------
function DnaSuggestionCard() {
  const t = useT();
  const suggestion = useStore((s) => s.dnaSuggestion);
  const clearDnaSuggestion = useStore((s) => s.clearDnaSuggestion);
  const sendMessage = useStore((s) => s.sendMessage);
  if (!suggestion) return null;
  const create = () => {
    void sendMessage(
      t('dna.sug.skillMsg', 'Create a skill from this repeated workflow: {t}').replace('{t}', suggestion.text),
    );
    clearDnaSuggestion();
  };
  return (
    <div className="px-3 pb-2">
      <div className="card p-2.5 anim-in" role="status">
        <div className="flex items-center gap-2 mb-1">
          <Repeat size={13} className="text-acc shrink-0" />
          <span className="text-[12px] font-semibold uppercase tracking-widest text-dim shrink-0">
            {t('dna.sug.title', 'Repeated workflow spotted')}
          </span>
          <button
            className="ibtn !w-8 !h-8 !-my-2 !-me-2 ms-auto shrink-0"
            onClick={clearDnaSuggestion}
            title={t('dna.sug.dismiss', 'Dismiss')}
            aria-label={t('dna.sug.dismiss', 'Dismiss')}
          >
            <span className="text-[11px] leading-none">×</span>
          </button>
        </div>
        <div className="text-[var(--chat-ui)] text-dim leading-relaxed mb-2" dir="auto">
          {t('dna.sug.body', 'SADEEM noticed you repeat: “{t}” — turn it into a skill?').replace('{t}', suggestion.text)}
        </div>
        <div className="flex items-center gap-1.5">
          <Btn variant="primary" className="!h-7 !px-2.5 !text-[12px]" onClick={create}>
            {t('dna.sug.create', 'Turn into skill')}
          </Btn>
          <Btn className="!h-7 !px-2.5 !text-[12px]" onClick={clearDnaSuggestion}>
            {t('dna.sug.dismiss', 'Dismiss')}
          </Btn>
        </div>
        <div className="text-[12px] text-faint mt-1.5 leading-relaxed">{t('dna.sug.hint', 'A skill is a reusable SKILL.md playbook — review the draft before relying on it')}</div>
      </div>
    </div>
  );
}

// Starter prompts fill the composer (via insertIntoComposer) instead of
// sending immediately — the user keeps control before the first run.
const STARTERS: { key: string; fb: string; icon: LucideIcon }[] = [
  { key: 'chat.starter.explain', fb: 'Explain this codebase', icon: BookOpen },
  { key: 'chat.starter.tests', fb: 'Add tests to the selected file', icon: FlaskConical },
  { key: 'chat.starter.app', fb: 'Build a small web app and preview it', icon: AppWindow },
  { key: 'chat.starter.assistant', fb: 'What is on my screen right now?', icon: Monitor },
  { key: 'chat.starter.doc', fb: 'Draft a one-page project report (PDF)', icon: FileText },
];

// ---------------- v7.2 contextual empty state (derived tasks) ----------------
// The empty console offers one-click prompts DERIVED from the live context:
// always the three core derived tasks (failing tests · TODOs · outdated
// deps) plus review-changes when the git rail reports uncommitted work.
// Buttons PREFILL the composer (same honest contract as STARTERS) — the
// user reviews, then sends. Prompts are fully bilingual.
function DerivedTasks() {
  const t = useT();
  const insertIntoComposer = useStore((s) => s.insertIntoComposer);
  const git = useStore((s) => s.git);
  const hasChanges = Boolean(git && git.changed.length > 0);
  const tasks: { key: string; fb: string; promptKey: string; promptFb: string; icon: LucideIcon }[] = [
    {
      key: 'chat.derived.tests',
      fb: 'Run failing tests',
      promptKey: 'chat.derived.tests.prompt',
      promptFb: 'Run the project test suite, list every failing test with its error, then fix them one by one — re-run after each fix until the suite is green.',
      icon: FlaskConical,
    },
    {
      key: 'chat.derived.todos',
      fb: 'List TODOs',
      promptKey: 'chat.derived.todos.prompt',
      promptFb: 'Search the codebase for TODO, FIXME and HACK comments and summarize them grouped by file, most urgent first.',
      icon: List,
    },
    {
      key: 'chat.derived.deps',
      fb: 'Check outdated deps',
      promptKey: 'chat.derived.deps.prompt',
      promptFb: 'Check the project dependencies for outdated versions (npm outdated or the project equivalent), then report major updates, breaking changes and a safe upgrade order.',
      icon: Repeat,
    },
  ];
  if (hasChanges) {
    tasks.push({
      key: 'chat.derived.review',
      fb: 'Review uncommitted changes',
      promptKey: 'chat.derived.review.prompt',
      promptFb: 'Review my uncommitted changes (git diff): findings by severity, risks, and what you would fix before commit.',
      icon: ShieldCheck,
    });
  }
  return (
    <div className="chat-empty-list mt-4">
      <div className="micro-label mb-1.5 text-start">{t('chat.derived.title', 'Start from your project')}</div>
      {tasks.map(({ key, fb, promptKey, promptFb, icon: DIcon }) => (
        <button
          key={key}
          className="chat-empty-row"
          title={t('chat.derived.hint', 'Fills the composer — review, then send')}
          onClick={() => insertIntoComposer(t(promptKey, promptFb))}
        >
          <DIcon size={13} className="shrink-0" />
          <span dir="auto">
            {t(key, fb)}
          </span>
          <PenLine size={10} className="text-faint shrink-0" />
        </button>
      ))}
    </div>
  );
}

/** 12345 → "12.3k" for the compact header usage chip. */
const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// ---------------- live plan (todos) — precise hairline button ----------------
// v11.34 — the founder called the always-open "Update plan" strip too wide.
// It is now a small, borderless BUTTON: a hairline rule, the bilingual label,
// a tabular done/total count and a 2px progress hairline. Clicking it expands
// the FULL todo list, so no data is ever hidden away permanently.
function PlanCard({ todos }: { todos: TodoItem[] }) {
  const t = useT();
  const langAr = useStore((s) => s.settings?.language === 'ar');
  const [open, setOpen] = useState(false);
  const done = todos.filter((td) => td.status === 'completed').length;
  const pct = todos.length > 0 ? Math.round((done / todos.length) * 100) : 0;
  const toggleTitle = langAr
    ? `إظهار الخطة · ${done}/${todos.length} خطوة منجزة`
    : `Show plan · ${done}/${todos.length} steps complete`;
  return (
    <div className="plan-dock anim-in">
      <button
        type="button"
        className="plan-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="plan-detail"
        title={toggleTitle}
      >
        <ListChecks size={13} className="text-acc shrink-0" aria-hidden />
        <span className="plan-toggle-label" dir="auto">{t('tool.todo_write')}</span>
        <span className="plan-toggle-count tnum" dir="ltr">{done}/{todos.length}</span>
        <span className="plan-toggle-meter" aria-hidden>
          <span style={{ width: `${Math.max(3, pct)}%` }} />
        </span>
        <ChevronDown size={12} className={`plan-chev ${open ? 'is-open' : ''}`} aria-hidden />
      </button>
      {open && (
        <div id="plan-detail" className="plan-detail" role="status">
          <TodoRows todos={todos} />
          <div className="plan-detail-meter" aria-hidden>
            <div style={{ width: `${Math.max(3, pct)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Aurora run phase strip (pinned above the stream) ----------------
// Slim horizontal progress strip for the CURRENT run: the activity label of
// the old v2.3 live pill, upgraded with a dot-per-phase sequence —
// THINK · WORK · BUILD · RUN · PROVE — derived ONLY from real store data:
//   · tool_call / tool_result transcript rows (unresolved tool_call = the
//     phase is ACTIVE; a matching tool_result marks it DONE), classified by
//     StreamTimeline.phaseOfTool — the same real mapping the bands use;
//   · prove-family meta rows the engine appends (verify · review-findings ·
//     goal-verified · critic · receipt · claim-audit · mutation-check ·
//     proof · mutation-gate · red-green · fake-tests · taint) → PROVE done;
//   · the streaming assistant tail → THINK active.
// Plus the live pill's original instruments: elapsed clock (captured on the
// running false→true edge), tool-call count and session tokens. Nothing is
// persisted; hidden entirely when the agent is idle.
const RUN_TICK_MS = 1000; // clock tick
const TEXT_IDLE_MS = 4500; // streaming with no deltas for this long → "waiting"

/** Basename of a path-ish arg, for "Editing app.ts…" style labels. */
const baseName = (v: string): string => v.split(/[\\/]/).pop() || v;

/**
 * True when the streamed tail is an UNCLOSED thinking block — mirrors
 * MessageView's splitContent contract (unclosed = thinking). v11.4 —
 * <think>…</think> and ```think are accepted as aliases of <thinking> /
 * ```thinking, so live reasoning never flashes as answer markdown either.
 */
function streamingThinking(raw: string): boolean {
  // v11.14 — the IPC boundary is untrusted: a forward-compatible / partially
  // hydrated row can carry a missing or non-string `content`. This predicate
  // runs on EVERY streaming delta, so an unguarded string method here throws
  // mid-render and blanks the whole transcript ("thinking stops"). Normalize
  // once at the boundary; well-formed text behaves exactly as before.
  const text = typeof raw === 'string' ? raw : '';
  for (const [open, close] of [
    ['<thinking>', '</thinking>'],
    ['<think>', '</think>'],
  ] as const) {
    const tag = text.lastIndexOf(open);
    if (tag >= 0 && text.lastIndexOf(close) < tag) return true;
  }
  for (const fence of ['```thinking', '```think'] as const) {
    const open = text.lastIndexOf(fence);
    if (open >= 0) return text.indexOf('```', open + fence.length) === -1;
  }
  return false;
}

/** Defensive transcript-text reads — see streamingThinking above. */
const msgText = (m: ChatMessage): string => (typeof m.content === 'string' ? m.content : '');
const thinkText = (m: ChatMessage): string => (typeof m.thinking === 'string' ? m.thinking : '');

/**
 * The current working-state PHASE, derived from the transcript tail (no new
 * store). v11.24: returns a GerundPhase for the quiet status line
 * (src/lib/streamDisplay.pickGerund chooses ONE stable, honest label per phase)
 * instead of a baked sentence — and never rotates it on a timer.
 */
interface RunActivity {
  phase: GerundPhase;
}

function useRunActivity(now: number): RunActivity | null {
  const running = useStore((s) => s.running);
  const approval = useStore((s) => s.pendingApproval);
  const msgs = useStore((s) => s.session?.messages ?? NO_MESSAGES);

  // last text-delta fingerprint — powers the "waiting for the model" idle state
  const streamRef = useRef({ len: 0, at: Date.now() });
  useEffect(() => {
    let len = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'assistant' && m.streaming) {
        // v11.31 — IPC rows are untrusted; a forward-compatible row can carry
        // a missing / non-string `content`. This effect runs on EVERY delta,
        // so read through the defensive accessor instead of throwing here.
        len = msgText(m).length;
        break;
      }
    }
    if (len !== streamRef.current.len) streamRef.current = { len, at: Date.now() };
  }, [msgs]);

  return useMemo(() => {
    if (!running) return null;
    if (approval) return { phase: 'approval' };

    // newest tool_call without a tool_result = the tool running NOW — its
    // REAL band phase drives the gerund (read/search → Exploring, edit/write
    // → Building, commands/tests → Verifying, todo/task → Thinking).
    const resolved = new Set<string>();
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.kind === 'tool_result' && m.toolCallId) resolved.add(m.toolCallId);
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.kind === 'tool_call') {
        if (m.toolCallId && resolved.has(m.toolCallId)) break; // moved past the tools
        return { phase: phaseOfTool(m.toolName) };
      }
      if (m.role === 'assistant' && m.streaming) {
        // v11.7 — the v11.3 think_delta channel lands in m.thinking; treat a
        // reasoning-only stream as THINKING (the legacy in-content tag check
        // stays as a fallback for persisted rows).
        const liveThink = !!thinkText(m).trim();
        if ((liveThink && !msgText(m).trim()) || streamingThinking(m.content)) {
          return { phase: 'think' };
        }
        // deltas stalled → the model is chewing, not writing
        if (now - streamRef.current.at > TEXT_IDLE_MS) return { phase: 'wait' };
        return { phase: 'build' };
      }
      break; // any other newest row → generic exploring state
    }
    return { phase: 'work' };
    // `now` drives the idle-phase re-evaluation; streamRef is a ref by design
  }, [running, approval, msgs, now]);
}

/** Assistant meta rows that belong to the PROVE phase — the membership list
 *  lives in StreamTimeline (exported PROVE_ROW_MODELS): one grammar for the
 *  run-phase strip AND the transcript bands (D3). */

interface RunPhaseState {
  key: StreamPhase;
  state: 'pending' | 'active' | 'done';
}

/**
 * Phase ledger for the CURRENT run, folded from the transcript rows that
 * landed since the run started (startAt = the running false→true edge).
 * Pure function over real store data — no invented phases, no timers.
 */
function deriveRunPhases(msgs: ChatMessage[], startAt: number): RunPhaseState[] {
  const resolved = new Set<string>();
  for (const m of msgs) {
    if (m.kind === 'tool_result' && m.toolCallId) resolved.add(m.toolCallId);
  }
  const acc: Record<StreamPhase, { active: number; done: number }> = {
    think: { active: 0, done: 0 },
    work: { active: 0, done: 0 },
    build: { active: 0, done: 0 },
    run: { active: 0, done: 0 },
    prove: { active: 0, done: 0 },
  };
  let counted = 0;
  for (const m of msgs) {
    if (m.timestamp < startAt) continue; // rows from BEFORE this run
    counted++;
    if (m.kind === 'tool_call') {
      const p = phaseOfTool(m.toolName);
      const unresolved = !m.toolCallId || !resolved.has(m.toolCallId);
      if (unresolved) acc[p].active++;
      else acc[p].done++;
    } else if (m.role === 'assistant') {
      if (PROVE_ROW_MODELS.has(m.model ?? '')) acc.prove.done++;
      else if (m.streaming) acc.think.active++;
      else acc.think.done++;
    }
  }
  // v11.31 — right after send, before the first engine row lands, BOTH strips
  // must show the same honest state: the run has started and THINK is active.
  // (The composer ledger applies the same seed.) This closes the perception
  // gap without inventing progress — it is the phase the run is already in.
  if (counted === 0) acc.think.active = 1;
  const order: StreamPhase[] = ['think', 'work', 'build', 'run', 'prove'];
  return order.map((key) => ({
    key,
    state: acc[key].active > 0 ? 'active' : acc[key].done > 0 ? 'done' : 'pending',
  }));
}

/**
 * FINAL POLISH — the tiny per-message status line:
 *   thinking → tools → answering → verified
 * Every phase is derived from the message's OWN real state (its reasoning
 * channel, the sibling tool rows of its band, its streaming flag and whether
 * answer text landed). No timers, no invented progress. A 1px hairline draws
 * up to the reached phase; the transition is gated by both motion preferences.
 */
const MSG_PHASES = ['thinking', 'tools', 'answering', 'verified'] as const;
type MsgPhase = (typeof MSG_PHASES)[number];
const MSG_PHASE_LABEL: Record<'en' | 'ar', Record<MsgPhase, string>> = {
  en: { thinking: 'THINKING', tools: 'TOOLS', answering: 'ANSWERING', verified: 'VERIFIED' },
  ar: { thinking: 'تفكير', tools: 'أدوات', answering: 'إجابة', verified: 'مُتحقَّق' },
};

function MessagePhaseLine({
  msg,
  hasTools,
  live,
}: {
  msg: ChatMessage;
  hasTools: boolean;
  live: boolean;
}) {
  const ar = useStore((s) => s.settings.language === 'ar');
  const reasoning = !!thinkText(msg).trim() || streamingThinking(msg.content);
  const hasAnswer = !!msgText(msg).trim() && !streamingThinking(msg.content);

  // reached phase index (0..3). Tools is a real milestone only when sibling
  // tool rows exist in this band; a tool-less turn skips straight to answer.
  let reached: number;
  if (msg.streaming) {
    reached = hasAnswer ? 2 : reasoning ? 0 : 2;
  } else {
    reached = hasAnswer || reasoning ? 3 : 0;
  }
  // tools becomes the CURRENT phase only when tool rows exist and no answer
  // text has landed yet; once text streams, "answering" is current.
  if (hasTools && reached === 0 && !hasAnswer) reached = 1;
  const phase = MSG_PHASES[reached];

  return (
    <div className={`cf-phase-line${live ? ' is-live' : ''}`} data-phase={phase} aria-hidden="true">
      <span className="cf-phase-track" aria-hidden="true">
        <i style={{ width: `${(reached / (MSG_PHASES.length - 1)) * 100}%` }} />
      </span>
      {MSG_PHASES.map((p, i) => (
        <span
          key={p}
          className={`cf-phase${i <= reached ? ' is-on' : ''}${i === reached ? ' is-current' : ''}`}
        >
          <i className="cf-pip" />
          <span dir="auto">{MSG_PHASE_LABEL[ar ? 'ar' : 'en'][p]}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * v11.11 (wave2-A1) — THE ONE QUIET WORKING-STATE LINE (founder #1).
 * The static working word and the 3-dot cascade rows are DEAD. While the
 * agent works, ONE quiet line is pinned above the stream:
 *   [one stable phase gerund]  [(elapsed) 0s / 59s / 1m 00s]
 *   [THINK · WORK · BUILD · RUN · PROVE dots]  [tools / tokens / Esc]
 * v11.24 — no ring, no sweeping wave, no shimmer: the founder saw a RING and
 * a WAVE right after send and text that "trembled". Only honest data remains.
 * v11.24 — the ONE live spinning circle now lives INSIDE this strip (the
 * founder: "shrink it and put it inside that strip"). The gerund + clock stay
 * with it for the whole run; the old stream-tail vanishing act is retired.
 */
function RunStatusLine() {
  const t = useT();
  const running = useStore((s) => s.running);
  const usage = useStore((s) => s.sessionUsage);
  const ar = useStore((s) => s.settings.language === 'ar');

  // v11.31 — the old "stream-tail gate" selector is REMOVED. It was subscribed
  // on every store notification but its boolean was never read by the render:
  // since v11.24 the one honest strip stays visible for the WHOLE run (the
  // gerund + clock do not vanish when text streams). Keeping a dead
  // useStore subscription re-rendered the strip for nothing and its comment
  // falsely claimed it owned the malformed-row guard — the real guards are
  // msgText()/thinkText() in useRunActivity and the `msgStamp` subscription
  // below, which reads fresh state on every structural row.

  const [now, setNow] = useState(() => Date.now());

  // D5 — cheap transcript subscription: the strip re-derives the phase ledger
  // the frame a row lands (length / tail-id primitives), not only on the 1s
  // clock tick. Streaming deltas replace the messages array, so these flip on
  // every structural row — and the strip cannot go stale between ticks.
  const msgStamp = useStore((s) => {
    const ms = s.session?.messages;
    return ms && ms.length > 0 ? `${ms.length}:${ms[ms.length - 1].id}` : '0';
  });
  void msgStamp; // consumed via re-render — deriveRunPhases reads fresh state below

  // run clock — captured at each false→true edge, reset on session switch.
  // D5 (audit #8): the edge is captured DURING RENDER, not only in the
  // post-render effect — the old first frame read a stale startRef and the
  // elapsed chip flashed a huge value.
  const startRef = useRef(Date.now());
  const prevRunningRef = useRef(running);
  if (running !== prevRunningRef.current) {
    prevRunningRef.current = running;
    if (running) startRef.current = Date.now();
  }
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), RUN_TICK_MS);
    return () => clearInterval(iv);
  }, [running]);

  const activity = useRunActivity(now);
  if (!running) return null;

  const msgs = useStore.getState().session?.messages ?? NO_MESSAGES;
  const phases = deriveRunPhases(msgs, startRef.current);

  const totalTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  let toolCount = 0;
  for (const m of msgs) if (m.kind === 'tool_call' && m.timestamp >= startRef.current) toolCount++;

  // v11.24 — ONE stable, honest label for the current phase, chosen from the
  // live phase with NO timer. The rotating gerund / keyed crossfade was the
  // "trembling text" the founder saw right after send — it is retired.
  const phase = activity?.phase ?? 'work';
  const token = pickGerund(phase);
  // v11.24 — the single circle in this strip: reduced motion parks it at 12.
  const orbitStatic =
    typeof document !== 'undefined' &&
    (document.documentElement.classList.contains('reduce-motion') ||
      (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches));

  return (
    <div className="phase-strip run-strip-v13 anim-in shrink-0">
      {/* v11.24 — the ONE precise spinning circle + its real bilingual label
          and elapsed clock live INSIDE this strip for the WHOLE run (even
          while text streams). No ring/wave, no rotating/trembling word. */}
      {/* the ONE precise live circle, inside the strip — 16px, integer
          radii r7/r3, equal-angle orbit, 12 o'clock tick, all 1px strokes. */}
      <svg
        className="sc-strip-orbit"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1" opacity="0.3" />
        <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1" opacity="0.55" />
        <path d="M8 1v2" stroke="currentColor" strokeWidth="1" opacity="0.7" />
        <g>
          {!orbitStatic && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 8 8"
              to="360 8 8"
              dur="2.2s"
              repeatCount="indefinite"
            />
          )}
          <circle cx="8" cy="2" r="1.5" stroke="currentColor" strokeWidth="1" opacity="0.75" />
          <circle cx="8" cy="2" r="0.75" fill="currentColor" />
        </g>
      </svg>
      <span className="sc-status-label" dir="auto" role="status">
        {t(`chat.gerund.${token}`, GERUND_EN[token])}
      </span>
      <span className="sc-status-clock tnum" dir="ltr" title={t('chat.run.elapsed', 'Elapsed')}>
        {`(${formatElapsedClock(now - startRef.current)})`}
      </span>
      <span className="phase-strip-sep" aria-hidden />
      {/* dot-per-phase — THINK · WORK · BUILD · RUN · PROVE */}
      <div className="phase-strip-steps" aria-hidden>
        {phases.map((p) => {
          const meta = BAND_META[p.key];
          return (
            <span
              key={p.key}
              className={`ps-step ${p.state === 'active' ? 'is-active' : p.state === 'done' ? 'is-done' : ''}`}
              style={{ '--ps-c': meta.cssVar } as React.CSSProperties}
            >
              <span className="ps-dot" />
              <span dir="auto">{ar ? meta.ar : meta.en}</span>
            </span>
          );
        })}
      </div>
      <span className="phase-strip-sep" aria-hidden />
      <span className="phase-strip-stat tnum" dir="ltr" title={t('chat.run.toolsTitle', 'Tool calls this run')}>
        {`${toolCount} ${t('chat.run.toolsShort', 'tools')}`}
      </span>
      {totalTokens > 0 && (
        <span className="phase-strip-stat tnum" dir="ltr" title={t('chat.tokens', '{in} in · {out} out')}>
          {`${fmtTokens(totalTokens)} tok`}
        </span>
      )}
      {/* v11.7 — Claude Code parity: the interrupt hint lives on the run strip */}
      <span className="phase-strip-hint" aria-hidden dir="auto">
        {t('chat.run.interrupt', 'Esc to interrupt')}
      </span>
    </div>
  );
}

/**
 * v12 (RESUME) — a one-click chip for a task interrupted by an app close.
 * Appears only at boot when a durable run marker was found.
 */
function ResumeTaskChip() {
  const t = useT();
  const r = useStore((s) => s.resumableRun);
  const resume = useStore((s) => s.resumeTask);
  const dismiss = useStore((s) => s.dismissResumable);
  const ar = useStore((s) => s.settings.language === 'ar');
  if (!r) return null;
  return (
    <div className="resume-chip anim-in" role="status">
      <span className="resume-icon" aria-hidden>⟳</span>
      <span className="resume-text" title={r.task}>
        {ar ? 'مهمة سابقة انقطعت — استئنافها؟' : 'A previous task was interrupted — resume it?'}
      </span>
      <button className="resume-btn" onClick={() => void resume()}>
        {ar ? 'استئناف' : 'Resume'}
      </button>
      <button className="resume-x" title={ar ? 'تجاهل' : 'Dismiss'} onClick={dismiss}>×</button>
    </div>
  );
}

/**
 * v12 (RECOVERY) — a QUIET, visible run-health line. Appears only when the
 * renderer watchdog detects no agent events for a while during a run. The
 * main process has its own watchdog/retry/failover; this line makes that
 * recovery visible instead of silent, and explains that the agent is still
 * working so the user does not assume it froze. Never invents progress.
 */
function RecoveryStatusLine() {
  const t = useT();
  const rec = useStore((s) => s.runRecovery);
  const ar = useStore((s) => s.settings.language === 'ar');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!rec) return;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [rec]);
  if (!rec) return null;
  const secs = Math.max(0, Math.round((now - rec.since) / 1000));
  if (rec.phase === 'recovered') return null; // the Resume chip says it already
  const label = rec.phase === 'recovering'
    ? (ar ? 'أطول من المتوقع — المحاولة مرة أخرى على مزود آخر…' : 'Taking longer than expected — retrying on another provider…')
    : (ar ? 'اتصال الوكيل هادئ لحظياً — جارٍ الاستعادة…' : 'Agent connection went quiet — recovering…');
  return (
    <div className="recovery-line anim-in" role="status" dir="auto">
      <span className="recovery-dot" aria-hidden />
      <span className="recovery-text">{label}</span>
      <span className="recovery-clock tnum" dir="ltr">{`+${secs}s`}</span>
    </div>
  );
}

// ---------------- plan approval contract (rendered in the transcript) --------
function PlanContract() {
  const t = useT();
  const plan = useStore((s) => s.planProposal);
  const approvePlan = useStore((s) => s.approvePlan);
  const [revising, setRevising] = useState(false);
  const [fb, setFb] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (revising) inputRef.current?.focus();
  }, [revising]);

  // reset the revise state whenever a new plan lands
  useEffect(() => {
    setRevising(false);
    setFb('');
  }, [plan?.title, plan?.raw]);

  if (!plan) return null;

  // keyboard-first: 1/2/3 while the contract is focused
  const onKey = (e: React.KeyboardEvent) => {
    if (revising) return; // typing feedback — don't hijack
    if (e.key === '1') {
      e.preventDefault();
      void approvePlan('auto');
    } else if (e.key === '2') {
      e.preventDefault();
      void approvePlan('manual');
    } else if (e.key === '3') {
      e.preventDefault();
      setRevising(true);
    }
  };

  return (
    <div
      className="contract tick-frame anim-in msg-in min-w-0 spec-ring"
      role="group"
      aria-label={t('chat.plan.title', 'Plan ready')}
      onKeyDown={onKey}
    >
      <div className="contract-head">
        {/* v7.2 — localized stamps (was hardwired 'PLAN' / 'N STEPS') */}
        <span className="stamp stamp-solid shrink-0">{t('chat.plan.stamp', 'PLAN')}</span>
        <span className="flex-1 min-w-0 truncate text-[12px] font-semibold" dir="auto" title={plan.title}>
          {plan.title}
        </span>
        <span className="tnum text-[12px] text-faint shrink-0" dir="ltr">
          {t('chat.plan.steps', '{n} STEPS', { n: plan.steps.length })}
        </span>
      </div>

      {plan.steps.length > 0 && (
        <div className="contract-body">
          {plan.steps.map((s, i) => (
            <div className="contract-step" key={i}>
              <span className="step-no tnum" dir="ltr">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0" dir="auto">
                {s}
              </span>
            </div>
          ))}
          {plan.risks.map((r, i) => (
            <div className="contract-step" key={`risk-${i}`}>
              <span className="step-no" style={{ color: 'var(--warn)' }}>
                !
              </span>
              <span className="min-w-0" dir="auto">
                {r}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="px-2.5 pb-1 pt-2 flex flex-col gap-1.5">
        <button className="contract-opt" onClick={() => void approvePlan('auto')}>
          <span className="opt-no tnum">01</span>
          <span className="opt-label">{t('chat.plan.auto', 'APPROVE — EXECUTE AUTO')}</span>
          <span className="opt-hint ms-auto hidden sm:inline truncate">
            {t('chat.plan.autoHint', 'edits auto · commands still ask')}
          </span>
        </button>
        <button className="contract-opt" onClick={() => void approvePlan('manual')}>
          <span className="opt-no tnum">02</span>
          <span className="opt-label">{t('chat.plan.manual', 'APPROVE — ASK PER STEP')}</span>
          <span className="opt-hint ms-auto hidden sm:inline truncate">
            {t('chat.plan.manualHint', 'confirm before every step')}
          </span>
        </button>
        <button className="contract-opt" onClick={() => setRevising((v) => !v)} aria-expanded={revising}>
          <span className="opt-no tnum">03</span>
          <span className="opt-label">{t('chat.plan.revise', 'REVISE')}</span>
          <span className="opt-hint ms-auto hidden sm:inline truncate">
            {t('chat.plan.reviseHint', 'send feedback · get a new plan')}
          </span>
        </button>
        {revising && (
          <div className="sc-revise">
            <input
              ref={inputRef}
              value={fb}
              onChange={(e) => setFb(e.target.value)}
              dir="auto"
              placeholder={t('chat.plan.revisePh', 'What should change in this plan?')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && fb.trim()) {
                  e.preventDefault();
                  void approvePlan('revise', fb.trim());
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setRevising(false);
                }
              }}
            />
            <Btn
              variant="primary"
              className="!h-[26px] !px-2.5 !text-[12px]"
              disabled={!fb.trim()}
              onClick={() => void approvePlan('revise', fb.trim())}
            >
              {t('chat.plan.send', 'SEND')}
            </Btn>
          </div>
        )}
        <div className="sc-contract-keys">
          <span>
            <span className="opt-no">1</span> {t('chat.plan.auto', 'approve auto')}
          </span>
          <span>
            <span className="opt-no">2</span> {t('chat.plan.manual', 'ask per step')}
          </span>
          <span>
            <span className="opt-no">3</span> {t('chat.plan.revise', 'revise')}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------- review findings card (top of transcript) ----------------
function ReviewCard() {
  const t = useT();
  const lastReview = useStore((s) => s.lastReview);
  const clearReview = useStore((s) => s.clearReview);
  if (!lastReview) return null;
  const findings: ReviewFinding[] = lastReview.findings ?? [];
  const clean = findings.length === 0;
  return (
    <div className="sc-findings anim-in min-w-0">
      <div className="sc-findings-head">
        <ShieldCheck size={12} className={clean ? 'text-ok shrink-0' : 'text-acc shrink-0'} />
        <span className="uppercase tracking-widest shrink-0">{t('chat.reviewTitle', 'REVIEW')}</span>
        {lastReview.summary && (
          <span className="truncate min-w-0 flex-1 opacity-80" title={lastReview.summary} dir="auto">
            {lastReview.summary}
          </span>
        )}
        {clean ? (
          <span className="stamp stamp-acc shrink-0">{t('chat.reviewClean', 'CLEAN')}</span>
        ) : (
          <span className="stamp stamp-clay shrink-0">{t('chat.review.findings', '{n} FINDINGS', { n: findings.length })}</span>
        )}
        <button
          className="ibtn !w-8 !h-8 !-my-2 !-me-2 shrink-0"
          onClick={clearReview}
          title={t('chat.reviewDismiss', 'Dismiss review')}
          aria-label={t('chat.reviewDismiss', 'Dismiss review')}
        >
          <span className="text-[11px] leading-none">×</span>
        </button>
      </div>
      {findings.length > 0 && (
        <div>
          {findings.map((f, i) => {
            const sev =
              f.severity === 'critical'
                ? ['CRIT', 'sc-sev-crit']
                : f.severity === 'major'
                  ? ['MAJ', 'sc-sev-maj']
                  : f.severity === 'minor'
                    ? ['MIN', 'sc-sev-min']
                    : ['NIT', 'sc-sev-nit'];
            return (
              <div className="finding" key={`${f.file}:${f.line ?? ''}:${i}`}>
                <span className={`f-sev ${sev[1]}`}>{sev[0]}</span>
                <div className="min-w-0 flex-1">
                  <span className="f-file" dir="ltr">
                    {f.file}
                    {typeof f.line === 'number' ? `:${f.line}` : ''}
                  </span>
                  <div className="f-note" dir="auto">
                    {f.note}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- skills strip (.surnia/skills) ----------------
function SkillsStrip() {
  const t = useT();
  const skills = useStore((s) => s.skills);
  const deleteSkill = useStore((s) => s.deleteSkill);
  const open = useStore((s) => s.skillsOpen);
  if (!open) return null;
  return (
    <div className="sc-skills" role="region" aria-label={t('chat.skills', 'Skills')}>
      <div className="sec-titled sc-skills-head px-2.5 py-1.5">
        <span className="sec-no">02</span>
        <span className="sec-tt">{t('chat.skills', 'SKILLS')}</span>
        <span className="sec-rule" />
        <span className="tnum text-[12px] text-faint shrink-0" dir="ltr">
          {skills.length}
        </span>
      </div>
      {skills.length === 0 ? (
        <div className="px-3 py-3 text-[var(--chat-ui)] text-faint" dir="auto">
          {t(
            'chat.skillsEmpty',
            'No skills yet — reusable SKILL.md files extracted from completed sessions appear here.',
          )}
        </div>
      ) : (
        skills.map((sk) => (
          <div className="keyrow" key={sk.slug} title={sk.path}>
            <div className="key-main min-w-0">
              <div className="key-title sc-skill-name" dir="ltr">
                {sk.name}
              </div>
              <div className="key-sub" dir="auto">
                {sk.description}
              </div>
            </div>
            <button
              className="ibtn !w-8 !h-8 !-my-2 shrink-0"
              title={t('chat.skillDelete', 'Delete skill')}
              aria-label={t('chat.skillDelete', 'Delete skill')}
              onClick={() => void deleteSkill(sk.slug)}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

export function ChatPanel() {
  const t = useT();
  const langAr = useStore((s) => s.settings?.language === 'ar');
  const session = useStore((s) => s.session);
  const running = useStore((s) => s.running);
  // v7.2 — focus mode: the panel becomes the ONLY work area (fills the shell)
  const focusMode = useStore((s) => s.focusMode);
  const setFocusMode = useStore((s) => s.setFocusMode);
  const todos = useStore((s) => s.todos);
  const pendingApproval = useStore((s) => s.pendingApproval);
  const model = useStore((s) => s.settings.model);
  const mode = useStore((s) => s.settings.permissionMode);
  const skillsOpen = useStore((s) => s.skillsOpen);
  const exportRecap = useStore((s) => s.exportRecap);
  const runReview = useStore((s) => s.runReview);
  const setSkillsOpen = useStore((s) => s.setSkillsOpen);
  const sendMessage = useStore((s) => s.sendMessage);
  const newSession = useStore((s) => s.newSession);
  const renameSession = useStore((s) => s.renameSession);
  const setModelPicker = useStore((s) => s.setModelPicker);
  const setMode = useStore((s) => s.setMode);
  const setRail = useStore((s) => s.setRail);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const decideApproval = useStore((s) => s.decideApproval);
  const planProposal = useStore((s) => s.planProposal);
  const insertIntoComposer = useStore((s) => s.insertIntoComposer);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [moreOpen, setMoreOpen] = useState(false); // header overflow menu (⋯)
  // v12 (DENSITY) — progressive disclosure: the passive proof/timeline rows
  // (and the skills strip) stack above every transcript and crowd it. Collapse
  // them behind a header toggle while idle; reveal on demand or while running.
  const [showPassive, setShowPassive] = useState(false);

  // ---- ask_user (question approval): free-text answer draft ----
  const [answerDraft, setAnswerDraft] = useState('');
  // v6 — editable rule scope (Antigravity scope-edit): prefilled with the
  // command's remembered pattern; the user may broaden it before saving an
  // always/never rule (e.g. "npm" covers every npm subcommand).
  const [scopeDraft, setScopeDraft] = useState('');
  useEffect(() => {
    setAnswerDraft(''); // a new approval starts a fresh answer
  }, [pendingApproval?.requestId]);

  // ---- resizable width (drag the panel's physical RIGHT edge; double-click resets) ----
  // The store persists the width and coordinates the shell; v11.34 adds a local
  // override so the chat can exceed the store's legacy 720px clamp on wide
  // windows. ChatPanel is the only reader of the numeric slice, so this stays
  // the single source of truth for what is actually rendered. Chat is physical
  // left in every language, so dragging right always widens.
  const chatWidth = useStore((s) => s.chatWidth);
  const setChatWidth = useStore((s) => s.setChatWidth);
  const [wideOverride, setWideOverride] = useState<number | null>(() => {
    const full = readFullChatWidth();
    return full > CHAT_MAX ? Math.min(effectiveChatMax(), full) : null;
  });
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const effectiveWidth = Math.min(effectiveChatMax(), Math.max(CHAT_MIN, wideOverride ?? chatWidth));
  const widthRef = useRef(effectiveWidth);

  /** Clamp, render, persist. Beyond CHAT_MAX the store clamp is bypassed by
   *  the local override (the store still receives a sane value for readers). */
  const applyWidth = useCallback((nextRaw: number) => {
    const next = Math.min(effectiveChatMax(), Math.max(CHAT_MIN, Math.round(nextRaw)));
    widthRef.current = next;
    if (next > CHAT_MAX) {
      setWideOverride(next);
      setChatWidth(CHAT_MAX);
      persistFullChatWidth(next);
    } else {
      setWideOverride(null);
      setChatWidth(next);
    }
  }, [setChatWidth]);

  // App.tsx publishes the resizer constraints and dispatches this on resize;
  // also listen to the native event so a wide chat never strands the work area
  // when the window shrinks.
  useEffect(() => {
    const reclamp = () => {
      const capped = Math.min(effectiveChatMax(), widthRef.current);
      if (capped !== widthRef.current) applyWidth(capped);
    };
    window.addEventListener('resize', reclamp);
    window.addEventListener('surnia:chat-reclamp', reclamp);
    return () => {
      window.removeEventListener('resize', reclamp);
      window.removeEventListener('surnia:chat-reclamp', reclamp);
    };
  }, [applyWidth]);

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const panel = panelRef.current;
    if (!panel) return;
    handle.setPointerCapture(e.pointerId);
    setResizing(true);
    const rect = panel.getBoundingClientRect();
    const startWidth = widthRef.current;
    // v12 — chat is on the PHYSICAL left in every language; its resize handle
    // is the right edge, so dragging right always widens (language-independent).
    const move = (ev: PointerEvent) => {
      const delta = ev.clientX - rect.right;
      applyWidth(startWidth + delta);
    };
    const up = (ev: PointerEvent) => {
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch {
        /* pointer already released */
      }
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setResizing(false);
      // applyWidth already persisted via the store / full-width localStorage.
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  // Double-click (or Enter/Space on the focused handle) resets to 55/45.
  const resetWidth = useCallback(() => {
    applyWidth(balancedChatWidth());
  }, [applyWidth]);

  // Keyboard-accessible resize: the separator is focusable and arrow keys move
  // it in readable steps (Shift = larger), Home/End jump to min/max, Enter
  // re-balances. Physical directions match the handle's fixed left/right side.
  const onResizeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 80 : 24;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = widthRef.current + step;
    else if (e.key === 'ArrowLeft') next = widthRef.current - step;
    else if (e.key === 'PageUp') next = widthRef.current + 80;
    else if (e.key === 'PageDown') next = widthRef.current - 80;
    else if (e.key === 'Home') next = CHAT_MIN;
    else if (e.key === 'End') next = effectiveChatMax();
    else if (e.key === 'Enter' || e.key === ' ') next = balancedChatWidth();
    if (next === null) return;
    e.preventDefault();
    applyWidth(next);
  };

  const resizeTitle = langAr
    ? 'اسحب أو اضغط ←/→ لتغيير الحجم · نقرة مزدوجة للاستعادة · Enter للتوازن'
    : 'Drag or press ←/→ to resize · double-click to reset · Enter to balance';

  const messages = session?.messages ?? [];
  const lastMsg = messages[messages.length - 1];

  // v11.11/v11.31 — the retired 3-dot working row's `pureThinking` gate and
  // the later `streamTailLive` selector were both DEAD (never read by the JSX)
  // yet dereferenced the streaming tail's `content` on every render/store
  // notification. One malformed/forward-compatible row without a string
  // `content` could throw and blank the whole transcript. The single guard
  // now lives in msgText()/thinkText(), used by useRunActivity, the scroll
  // counter and MessagePhaseLine — no dead subscription remains.

  // ---- rendered history window (last N messages; raised by the load-earlier chip) ----
  const [renderLimit, setRenderLimit] = useState(RENDER_WINDOW);
  const windowStart = Math.max(0, messages.length - renderLimit);
  const visibleMessages = windowStart > 0 ? messages.slice(windowStart) : messages;
  const hiddenCount = windowStart;

  // ---- SR announcer — updates ONLY when a reply finishes (message_end /
  // turn_end transitions the streaming tail) so screen readers hear completed
  // turns, never per-token chatter. A tool_start also clears the streaming
  // flag but pushes a tool row, so the assistant-tail check filters it out. ----
  const [srAnnounce, setSrAnnounce] = useState('');
  const prevTailStreamingRef = useRef(false);
  useEffect(() => {
    const last = messages[messages.length - 1];
    const streaming = !!last && last.role === 'assistant' && !!last.streaming;
    if (prevTailStreamingRef.current && !streaming && last && last.role === 'assistant') {
      setSrAnnounce(t('chat.sr.replyDone', 'Assistant reply finished'));
    }
    prevTailStreamingRef.current = streaming;
  }, [messages, t]);

  // ---- retry: re-send the last user message through the same store path the
  // Composer uses (sendMessage). Only offered on the newest assistant turn
  // while the agent is idle.
  const handleRetry = useCallback(() => {
    const st = useStore.getState();
    if (st.running || !st.session) return;
    const msgs = st.session.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user' && msgs[i].model !== 'steer' && msgs[i].model !== 'queued') {
        void st.sendMessage(msgs[i].content, msgs[i].images);
        return;
      }
    }
  }, []);

  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  }, [messages]);
  const canRetry = !running && !!lastAssistantId && messages.some((m) => m.role === 'user');

  // v11.8 — turn-group starts: the first assistant row after a user row (or
  // session start) carries the agent-dot + model stamp header; every later
  // assistant row of the same turn stays clean (model + time live in its
  // hover action bar instead of repeating "SADEEM · time" per row).
  const turnStartIds = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === 'assistant' && (i === 0 || messages[i - 1].role === 'user')) set.add(m.id);
    }
    return set;
  }, [messages]);

  // ---- stable tool_result lookup (keeps MessageView rows memoized) ----
  const resultById = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages) {
      if (m.kind === 'tool_result' && m.toolCallId) map.set(m.toolCallId, m);
    }
    return map;
  }, [messages]);

  // ---- auto-scroll excellence (v2.3 + v3.2 perf) ----
  // Stick to the bottom while content streams UNLESS the user scrolled up
  // beyond SCROLL_STICK_PX; while detached, count the new lines that land and
  // surface them on the floating jump pill. Streaming snaps stay instant
  // (smooth scrolling fights the deltas); the jump pill respects reduce-motion.
  // v3.2: the scrollHeight read / scrollTop write is batched into one
  // requestAnimationFrame — a forced-layout pass per token made streaming jank.
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [pendingLines, setPendingLines] = useState(0);
  // tail snapshot for the detached new-line counter (id + consumed lengths:
  // answer content AND reasoning — D6 counts both channels)
  const tailRef = useRef({ id: '', len: 0, thinkLen: 0 });
  // v11.14 — `lastMsg?.content.length` throws when a row's `content` is
  // missing/non-string; read through the defensive accessor instead.
  const lastLen = lastMsg ? msgText(lastMsg).length : 0;
  // D6 — pure-reasoning growth must scroll the outer stream too: the last
  // message's thinking length joins the effect deps alongside content length
  // (think_delta appends never touch `content`, so the old deps never fired).
  const lastThinkLen = lastMsg ? thinkText(lastMsg).length : 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottomRef.current) {
      // one scroll write per frame at most; re-checks pinning at frame time
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
      const id = lastMsg?.id ?? '';
      const len = lastLen;
      const tLen = lastThinkLen;
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        const node = scrollRef.current;
        if (!node || !nearBottomRef.current) return;
        // instant scroll during streaming — smooth scrolling fights the deltas
        node.scrollTop = node.scrollHeight;
        tailRef.current = { id, len, thinkLen: tLen };
      });
      return;
    }
    // detached — accumulate what's new since the snapshot
    const id = lastMsg?.id ?? '';
    if (id !== tailRef.current.id) {
      setPendingLines((p) => p + 1); // a whole new block landed (tool card / message)
      tailRef.current = { id, len: lastLen, thinkLen: lastThinkLen }; // don't double-count its content
    } else if (lastMsg && (lastLen > tailRef.current.len || lastThinkLen > tailRef.current.thinkLen)) {
      // D6 — count structural rows (new block above) + newlines on BOTH
      // channels: the answer delta and the thinking delta.
      let nl = 0;
      if (lastLen > tailRef.current.len) {
        const delta = msgText(lastMsg).slice(tailRef.current.len);
        for (let i = 0; i < delta.length; i++) if (delta.charCodeAt(i) === 10) nl++;
      }
      if (lastThinkLen > tailRef.current.thinkLen) {
        const think = thinkText(lastMsg);
        const delta = think.slice(tailRef.current.thinkLen);
        for (let i = 0; i < delta.length; i++) if (delta.charCodeAt(i) === 10) nl++;
      }
      if (nl > 0) setPendingLines((p) => p + nl);
      tailRef.current = { id, len: lastLen, thinkLen: lastThinkLen };
    }
    // D6 — deps now include the reasoning length so pure THINK growth re-runs
    // the scroll/counter effect (tool rows already land via messages.length).
  }, [messages.length, lastMsg?.id, lastLen, lastThinkLen, running, todos.length, planProposal]);

  // cancel any pending scroll frame on unmount
  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    },
    [],
  );

  // session switch: snap to the bottom immediately
  useEffect(() => {
    nearBottomRef.current = true;
    setAtBottom(true);
    setPendingLines(0);
    setRenderLimit(RENDER_WINDOW); // history window resets per session
    tailRef.current = { id: '', len: 0, thinkLen: 0 };
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.id]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_STICK_PX;
    nearBottomRef.current = near;
    if (near) {
      tailRef.current = { id: lastMsg?.id ?? '', len: lastLen, thinkLen: lastThinkLen };
      setPendingLines(0);
    }
    setAtBottom((prev) => (prev === near ? prev : near));
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    nearBottomRef.current = true;
    setAtBottom(true);
    setPendingLines(0);
    if (!el) return;
    // reduce-motion (app setting or OS preference) → instant snap
    const reduced =
      document.documentElement.classList.contains('reduce-motion') ||
      (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduced) el.scrollTop = el.scrollHeight;
    else el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  // ---- panel-level drag & drop → routes into the Composer attachments ----
  const dragDepth = useRef(0);
  const [panelDrag, setPanelDrag] = useState(false);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const onPanelDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setPanelDrag(true);
  };
  const onPanelDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onPanelDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setPanelDrag(false);
  };
  const onPanelDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setPanelDrag(false);
    composerBridge.attachFiles?.(e.dataTransfer.files);
  };

  const cycleMode = () => {
    setMode(nextIn(PERMISSION_MODES, mode));
  };

  const openSessionsRail = () => {
    const st = useStore.getState();
    const wasSessions = st.rail === 'sessions';
    st.setRail('sessions'); // setRail already opens the sidebar when switching views
    // If we were already on sessions, setRail toggled the sidebar — make sure it ends up open.
    if (wasSessions && !useStore.getState().sidebarOpen) useStore.getState().toggleSidebar();
  };

  // v2.3 — share: export the current session as a standalone HTML file.
  // Main shows a save dialog (defaults to Downloads) and returns the path.
  const exportSessionHtml = async () => {
    const st = useStore.getState();
    const sid = st.session?.id;
    if (!sid) return;
    try {
      const res = await api.sessionExportHtml(sid);
      if (res.ok && res.path) {
        st.notify(t('chat.export.done', 'Session exported — {path}').replace('{path}', res.path));
      } else if (res.canceled) {
        st.notify(t('chat.export.canceled', 'Export canceled'));
      } else {
        st.notify(res.error ?? t('misc.error', 'Error'));
      }
    } catch {
      st.notify(t('misc.error', 'Error'));
    }
  };

  const commitRename = () => {
    setEditing(false);
    if (session && draft.trim() && draft.trim() !== session.title) {
      void renameSession(session.id, draft.trim());
    }
  };

  const modeTone: 'default' | 'acc' | 'warn' = mode === 'fullAccess' ? 'warn' : mode === 'autoEdit' ? 'acc' : 'default';
  const isDoomLoop = pendingApproval?.kind === 'doom_loop';
  const isQuestion = pendingApproval?.kind === 'question';
  const showApproval = !!pendingApproval && pendingApproval.kind !== 'write';

  /** ask_user free-text submit (Enter on the inline input or the send button). */
  const submitAnswer = () => {
    const v = answerDraft.trim();
    if (!v || !pendingApproval || pendingApproval.kind !== 'question') return;
    void decideApproval('answer', v);
  };

  // ---- approval keyboard shortcuts: ↵ approve once · ⌫ deny · A always ----
  // ask_user questions map 1-4 to their choice buttons instead. Active only
  // while the inline card is visible AND no text input is focused (so typing
  // in the composer / the answer field is never hijacked).
  useEffect(() => {
    if (!showApproval || !pendingApproval) return;
    const isQuestion = pendingApproval.kind === 'question';
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === 'INPUT' ||
          tgt.tagName === 'TEXTAREA' ||
          tgt.tagName === 'SELECT' ||
          tgt.isContentEditable ||
          tgt.closest?.('[contenteditable="true"]'))
      )
        return;
      if (isQuestion) {
        // questions answer with 1-4 → the matching choice button
        const choices = pendingApproval.choices ?? [];
        const idx = ['1', '2', '3', '4'].indexOf(e.key);
        if (idx >= 0 && idx < choices.length) {
          e.preventDefault();
          void decideApproval('answer', choices[idx]);
        }
        return; // Enter/⌫/A have no meaning for a question
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        void decideApproval('allow');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        void decideApproval('deny');
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        void decideApproval('always', scopeDraft.trim() || undefined);
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        void decideApproval('never', scopeDraft.trim() || undefined);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [showApproval, pendingApproval, decideApproval, scopeDraft]);

  // ---- session-load skeleton: SessionsPanel announces the load on the window
  // bus — show shimmer rows until it lands ----
  const [sessionLoading, setSessionLoading] = useState(false);
  useEffect(() => {
    const start = () => setSessionLoading(true);
    const end = () => setSessionLoading(false);
    window.addEventListener('surnia:session-loading', start);
    window.addEventListener('surnia:session-loaded', end);
    return () => {
      window.removeEventListener('surnia:session-loading', start);
      window.removeEventListener('surnia:session-loaded', end);
    };
  }, []);

  // ROOT LAYOUT CONTRACT (chat.css §0): the .chat-panel-root class owns the
  // fill-the-dock geometry (width:100% · height:100% · min-width:0 · one
  // inline-start hairline). Docked mode applies the persisted, user-resizable
  // store width via inline style; focus mode takes the whole shell row.
  return (
    <div
      ref={panelRef}
      className={`chat-panel-root ${focusMode ? 'is-focus' : 'is-docked'}`}
      style={focusMode ? undefined : { width: effectiveWidth }}
      onDragEnter={onPanelDragEnter}
      onDragOver={onPanelDragOver}
      onDragLeave={onPanelDragLeave}
      onDrop={onPanelDrop}
    >
      {/* right-edge resize handle — drag, double-click, or focus + arrows.
          Keyboard support makes the same resize reachable without a pointer. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('chat.resizePanel', 'Resize chat panel')}
        aria-valuemin={CHAT_MIN}
        aria-valuemax={effectiveChatMax()}
        aria-valuenow={effectiveWidth}
        aria-valuetext={`${effectiveWidth}px`}
        tabIndex={0}
        title={resizeTitle}
        className={`chat-resizer ${resizing ? 'is-dragging' : ''}`}
        onPointerDown={onResizeStart}
        onDoubleClick={resetWidth}
        onKeyDown={onResizeKeyDown}
      />
      {/* panel-level drop overlay (Composer handles its own) */}
      {panelDrag && (
        <div className="absolute inset-0 z-30 border-2 border-dashed border-acc bg-[color-mix(in_srgb,var(--acc)_8%,transparent)] flex items-center justify-center pointer-events-none anim-in">
          <span className="card px-3 py-1.5 text-[12px] font-medium text-acc">
            {t('chat.drop', 'Drop files to attach')}
          </span>
        </div>
      )}

      {/* ---------- header: 01 — AGENT CONSOLE ----------
          v2.6 restructure: the five SECONDARY actions (recap · html export ·
          review · skills · compact) collapse into one overflow menu so the
          section label, session title and model chip keep real room at the
          console's 300px width — nothing truncates to "Da…" anymore. */}
      <div className={`chat-head chat-head-v13 ${running ? 'is-running' : ''}`}>
        {/* v13 — the square brand mark replaces the old "01 · AGENT CONSOLE" stamp */}
        <span className="chat-brand-v13" aria-hidden="true">S</span>
        <div className="sec-titled sc-sec-inline shrink-0">
          <span className="sec-no">01</span>
          <span className="sec-tt">{t('chat.console', 'AGENT CONSOLE')}</span>
          <span className="sec-rule" />
        </div>
        {/* session title (double-click to rename) */}
        {editing && session ? (
          <TextInput
            autoFocus
            dir="auto"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={commitRename}
            onFocus={(e) => e.target.select()}
            className="chat-title-v13 !h-7 flex-1 min-w-[6ch] !text-[12px] !px-2"
          />
        ) : (
          <button
            className="chat-title-v13 hidden lg:block flex-1 min-w-0 max-w-[24ch] truncate text-[13px] text-faint hover:text-[var(--ink)] cursor-text transition-colors text-start"
            title={session?.title ?? t('chat.new', 'New session')}
            onDoubleClick={() => {
              if (!session) return;
              setDraft(session.title);
              setEditing(true);
            }}
          >
            {session?.title ?? t('chat.new', 'New session')}
          </button>
        )}
        {/* v13 — three quiet state dots: ok · idle · idle (first goes live while running) */}
        <span className="chat-status-v13" aria-hidden="true">
          <i /><i /><i />
        </span>
        {/* v11.24 — every decorative header live circle is gone. The ONE
            small circle now lives in the timeline strip (A4 / MessageView). */}
        {/* v11.21 — the context ring was MOVED to the composer, beside the
            voice-input mic. No duplicate ring here (or in the status bar). */}
        {/* model chip — bare model id (provider prefix dropped), full id in tooltip */}
        <button
          className="shrink-0 min-w-0 cursor-pointer"
          onClick={() => setModelPicker(true)}
          title={`${model.provider}/${model.model}`}
          aria-label={t('mp.title', 'Choose model')}
        >
          <Chip className="font-code tnum !text-[12px] !h-[18px] max-w-[13ch] hover:!text-[var(--ink)] transition-colors">
            <span className="truncate min-w-0" dir="ltr">
              {shortModel(model.model)}
            </span>
          </Chip>
        </button>
        <button
          className="shrink-0 cursor-pointer"
          onClick={cycleMode}
          title={t(`tb.mode.${mode}.desc`)}
          aria-label={t(`tb.mode.${mode}`, mode)}
        >
          <Chip tone={modeTone} className="!text-[12px] !h-[18px]">
            {t(`tb.mode.${mode}`)}
          </Chip>
        </button>

        {/* control cluster: overflow menu · new · sessions
            (secondary actions live in the ⋯ menu — see header comment) */}
        <span className="w-px h-4 bg-[var(--line)] shrink-0" aria-hidden />
        <div className="relative shrink-0">
          <IconBtn
            title={t('chat.more', 'More actions')}
            aria-label={t('chat.more', 'More actions')}
            aria-expanded={moreOpen}
            active={moreOpen}
            className="!w-8 !h-8"
            onClick={() => setMoreOpen((v) => !v)}
          >
            <MoreHorizontal size={14} />
          </IconBtn>
          {moreOpen && (
            <>
              <div
                className="fixed inset-0 z-[60]"
                onClick={() => setMoreOpen(false)}
                aria-hidden
              />
              <div
                className="glass-menu absolute top-[calc(100%+6px)] z-[61] min-w-[190px] py-1 rounded-[10px] anim-glass-pop"
                style={{ insetInlineEnd: 0 }}
                role="menu"
              >
                {(
                  [
                    {
                      ico: Download,
                      label: t('chat.recap', 'Export recap (Markdown)'),
                      disabled: !session,
                      run: () => void exportRecap(),
                    },
                    {
                      ico: FileDown,
                      label: t('chat.export.html', 'Export session as HTML (share)'),
                      disabled: !session,
                      run: () => void exportSessionHtml(),
                    },
                    {
                      ico: ShieldCheck,
                      label: t('chat.reviewRun', 'Run structured review'),
                      disabled: !session || running,
                      run: () => void runReview(),
                    },
                    {
                      ico: Wrench,
                      label: t('chat.skills', 'Skills'),
                      disabled: false,
                      // v11.36 — open the REAL Skills library panel. The old
                      // setSkillsOpen() toggled a thin strip that was often
                      // empty → "clicking shows nothing" (founder's complaint).
                      run: () => setRail('skills'),
                    },
                    {
                      ico: Shrink,
                      label: t('chat.compact'),
                      disabled: running,
                      run: () => void sendMessage('/compact'),
                    },
                  ] as const
                ).map(({ ico: MIco, label, disabled, run }) => (
                  <button
                    key={label}
                    role="menuitem"
                    disabled={disabled}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[var(--chat-ui)] text-start text-[var(--dim)] hover:text-[var(--ink)] hover:bg-[var(--hover-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    onClick={() => {
                      setMoreOpen(false);
                      run();
                    }}
                  >
                    <MIco size={13} className="shrink-0" />
                    <span className="truncate min-w-0" dir="auto">
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <IconBtn title={t('chat.new')} className="!w-8 !h-8 shrink-0" onClick={() => void newSession()}>
          <MessageSquarePlus size={14} />
        </IconBtn>
        <IconBtn title={t('rail.sessions')} className="!w-8 !h-8 shrink-0" onClick={openSessionsRail}>
          <List size={14} />
        </IconBtn>
        {/* v12 (DENSITY) — reveal/hide the passive context rows. The lime
            underline marks the expanded state; no new hue introduced. */}
        <IconBtn
          title={showPassive ? t('chat.hideDetails', 'Hide run details') : t('chat.showDetails', 'Show run details')}
          className={`!w-8 !h-8 shrink-0 ${showPassive ? 'text-acc' : ''}`}
          onClick={() => setShowPassive((v) => !v)}
        >
          <PanelsTopLeft size={14} />
        </IconBtn>
        {/* v12 (D) — zen/focus toggle, discoverable from the chat itself.
            Esc exits (handled in App.tsx); the tooltip shows the shortcut. */}
        <IconBtn
          title={
            focusMode
              ? t('chat.focusExit', 'Exit focus mode (Esc)')
              : t('chat.focusEnter', 'Focus mode — just the chat (Esc to exit)')
          }
          aria-label={
            focusMode
              ? t('chat.focusExit', 'Exit focus mode (Esc)')
              : t('chat.focusEnter', 'Focus mode — just the chat (Esc to exit)')
          }
          aria-pressed={focusMode}
          active={focusMode}
          className="!w-8 !h-8 shrink-0"
          onClick={() => setFocusMode(!focusMode)}
        >
          {focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconBtn>
      </div>

      {/* v12 (D) — when focus mode is on, a quiet one-line hint makes the
          hidden-chrome state legible and teaches the Esc exit affordance. */}
      {focusMode && (
        <div className="sc-focus-hint" role="status">
          <Maximize2 size={10} className="shrink-0 text-acc" aria-hidden />
          <span dir="auto">{t('chat.focusHint', 'Zen focus — rail, sidebar and editor are hidden.')}</span>
          <span className="ms-auto shrink-0" dir="auto">
            <Kbd>Esc</Kbd> {t('chat.focusExitShort', 'to exit')}
          </span>
        </div>
      )}

      {/* ---------- v12 (CALM) — passive cards collapse into ONE "Run details"
          popover while idle (Codex-style quiet surface); they stay inline only
          while a run is active, so timeline/goal remain visible at work.
          v11.17 — PROOF is no longer one of these inline rows. The founder's
          complaint was that proof/claim strips crowd every answer; A2 turned
          ProofRibbon into a self-contained small PROOF button + popover, and
          it now has exactly ONE home in the message tail (see below). It is
          self-gating, so a plain chat turn renders nothing here. ---------- */}
      {showPassive && !running && (
        <div className="chat-run-details glass-menu relative z-[61] mx-2 mt-1" role="dialog" aria-label={t('chat.runDetails', 'Run details')}>
          <GoalBanner />
          <SessionTimeline />
          <SkillsStrip />
        </div>
      )}
      {running && (
        <div className="chat-passive-rows">
          <GoalBanner />
          <SessionTimeline />
        </div>
      )}
      {/* v11.19 — run strip placed UNDER the session timeline, as requested. */}
      <RunStatusLine />

      {/* ---------- messages ---------- */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        {/* SR-only turn announcer — the transcript itself is NOT aria-live
            (per-token announcements made streaming unusable); this role=status
            div updates only when a reply finishes. */}
        <div role="status" className="sr-only">
          {srAnnounce}
        </div>
        {/* v11.19 — the run strip (THINK · WORK · BUILD · RUN · PROVE) now lives
            BELOW the session timeline (founder: "put it under the timeline"),
            not pinned above the stream. See the placement after the passive
            rows block below. */}
        <ResumeTaskChip />
        <RecoveryStatusLine />
        <div
          ref={scrollRef}
          onScroll={onScroll}
          // v11.8 — spacing/padding live in chat.css now: 18px between bands,
          // 16-20px transcript padding, slim scrollbar, max measure 720px.
          className="chat-stream chat-stream-v13 flex-1 min-h-0 overflow-y-auto flex flex-col"
          aria-busy={sessionLoading}
        >
          {/* v11.24 — the big live circle was REMOVED. A4 mounts the ONE small
              circle inside the timeline strip (MessageView); the run strip
              above still gives immediate, honest liveness on run_start. */}
          {sessionLoading ? (
            // session-load skeleton — 3 shimmer rows while the session arrives
            <div className="flex flex-col gap-4 anim-in" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <div className="shimmer h-2.5 rounded-full" style={{ width: `${70 - i * 12}%` }} />
                  <div className="shimmer h-2.5 rounded-full" style={{ width: `${52 - i * 9}%` }} />
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            // ---------- empty state: designed, not blank ----------
            // logo mark context + real actions only (derived tasks & starters
            // fill the composer; New session wires the existing store action).
            // No fake data.
            <div className="chat-empty anim-in">
              <div className="chat-empty-mark">
                <Logo size={40} />
              </div>
              <div className="chat-empty-title" dir="auto">{t('chat.empty1')}</div>
              <div className="chat-empty-sub" dir="auto">{t('chat.empty2')}</div>
              {/* v7.2 — contextual derived tasks (tests / TODOs / deps / review) */}
              <DerivedTasks />
              <div className="chat-empty-list mt-3">
                {STARTERS.map(({ key, fb, icon: SIcon }) => (
                  <button
                    key={key}
                    className="chat-empty-row"
                    title={t('chat.starterHint', 'Fills the composer — review, then send')}
                    onClick={() => insertIntoComposer(t(key, fb))}
                  >
                    <SIcon size={13} className="shrink-0" />
                    <span dir="auto">{t(key, fb)}</span>
                    <PenLine size={10} className="text-faint shrink-0" />
                  </button>
                ))}
              </div>
              <button className="chat-empty-cta" onClick={() => void newSession()}>
                <MessageSquarePlus size={12} />
                <span dir="auto">{t('chat.new', 'New session')}</span>
              </button>
              <div className="chat-empty-hint" dir="auto">{t('chat.starterHint', 'Fills the composer — review, then send')}</div>
            </div>
          ) : (
            <>
              {/* history window — load-earlier glass chip (only when truncated) */}
              {hiddenCount > 0 && (
                <div className="flex justify-center pb-1">
                  <button
                    className="glass grain rounded-full px-3 py-1 text-[12px] text-dim hover:text-[var(--ink)] transition-colors cursor-pointer"
                    title={t(
                      'chat.loadEarlier.hint',
                      'Only the newest messages are mounted for speed — click to reveal more. Tool results stay paired with their calls.',
                    )}
                    onClick={() => setRenderLimit((n) => n + RENDER_STEP)}
                  >
                    {`${t('chat.loadEarlier', 'Load earlier messages')} · ${hiddenCount} earlier hidden · showing ${visibleMessages.length} of ${messages.length}`}
                  </button>
                </div>
              )}
              {/* latest review result pinned to the top of the transcript */}
              <ReviewCard />
              {/* v8.1 — THE STREAM: phase-banded timeline (THINK/WORK/BUILD/
                  RUN/PROVE). Same MessageView cards inside, now grouped into
                  instrument bands by the StreamTimeline grouper. */}
              {(() => {
                const msgById = new Map(visibleMessages.map((m) => [m.id, m] as const));
                const bands = groupStreamBands(visibleMessages);
                const lastBandIdx = bands.length - 1;
                // D4 — a tool_result row is PAIRED (renders inline inside its
                // tool_call card via resultById) whenever its call row exists
                // anywhere in the visible window; otherwise it was previously
                // DROPPED with the band (result-only bands returned null —
                // e.g. the render window cutting mid-turn). Orphans now reach
                // MessageView's .sc18-solo-res row instead of vanishing.
                const visibleCallIds = new Set<string>();
                for (const m of visibleMessages) {
                  if (m.kind === 'tool_call' && m.toolCallId) visibleCallIds.add(m.toolCallId);
                }
                return bands.map((band, bi) => {
                  const items = band.ids
                    .map((id) => msgById.get(id))
                    .filter((m): m is ChatMessage => !!m);
                  const rendered = items.filter(
                    (m) =>
                      m.kind !== 'tool_result' ||
                      !m.toolCallId ||
                      !visibleCallIds.has(m.toolCallId),
                  );
                  if (!rendered.length) return null;
                  // v11.12 polish — all `task` tool calls in this turn
                  // collapse into ONE elegant agent-team card (a chip per
                  // specialist) at the first launch, instead of a stack of
                  // tiny instrument rows. Narration between launches stays
                  // in place; only the duplicate task rows are removed.
                  const teamMsgs = rendered.filter((m) => m.kind === 'tool_call' && m.toolName === 'task');
                  // FINAL POLISH — real inputs for the per-message phase line.
                  const bandHasTools = rendered.some((m) => m.kind === 'tool_call');
                  const bandLive =
                    running && bi === lastBandIdx && rendered.some((m) => m.streaming || m.kind === 'tool_call');
                  let teamPlaced = false;
                  const rows: React.ReactNode[] = [];
                  for (const m of rendered) {
                    if (m.kind === 'tool_call' && m.toolName === 'task') {
                      if (!teamPlaced && teamMsgs.length) {
                        teamPlaced = true;
                        rows.push(<AgentTeamCard key={`team-${teamMsgs[0].id}`} tasks={teamMsgs} resultById={resultById} />);
                      }
                      continue;
                    }
                    // v11.19 — the per-turn phase line (THINKING/TOOLS/
                    // ANSWERING/VERIFIED) was removed: the founder found it
                    // noisy and asked for it gone. Liveness comes from the
                    // streaming glyph + the work strip, not a text row.
                    rows.push(
                      <MessageView
                        key={m.id}
                        msg={m}
                        result={m.kind === 'tool_call' && m.toolCallId ? resultById.get(m.toolCallId) : undefined}
                        canRetry={canRetry && m.id === lastAssistantId}
                        onRetry={handleRetry}
                        turnStart={turnStartIds.has(m.id)}
                      />,
                    );
                  }
                  // user band → bare column: the compact right-aligned card
                  // never wears phase chrome (band.user closes it to narration)
                  if (band.user) {
                    return (
                      <div key={`user-${band.ids[0]}`} className="sc18-userband">
                        {rows}
                      </div>
                    );
                  }
                  // the live band is the last one while the agent streams
                  const live = bandLive;
                  const label =
                    band.phase === 'prove'
                      ? t('chat.phaseProve', 'gates & proof')
                      : band.phase === 'build'
                        ? t('chat.phaseBuild', 'files changed')
                        : band.phase === 'run'
                          ? t('chat.phaseRun', 'commands')
                          : band.phase === 'work'
                            ? t('chat.phaseWork', 'investigation')
                            : t('chat.phaseThink', 'reasoning');
                  // v11.8 — the band header carries REAL duration + count:
                  // closed bands show last-timestamp − first-timestamp; the
                  // live band ticks every second inside StreamBandShell.
                  return (
                    <StreamBandShell
                      key={`${band.phase}-${band.ids[0]}`}
                      phase={band.phase}
                      live={live}
                      label={label}
                      count={rendered.length}
                      startAt={items[0]?.timestamp}
                      endAt={live ? undefined : items[items.length - 1]?.timestamp}
                    >
                      {rows}
                    </StreamBandShell>
                  );
                });
              })()}
            </>
          )}

          {/* plan approval contract — lives in the transcript flow (any state) */}
          {planProposal && <PlanContract />}

          {/* v11.17 — ONE quiet PROOF button in the message tail. A2's
              self-contained ProofRibbon renders a compact button (+ popover)
              only when this turn has real evidence; a plain chat turn renders
              nothing, so this stable spot never shifts the layout. Keeping a
              single mount — instead of the old three (idle popover / running
              row / idle inline) — ends the per-answer proof/claim clutter. */}
          <ProofRibbon />

          {/* v11.11 (wave2-A1) — the 3-dot working row is RETIRED: no bare
              dot cascade, no static working word. The ONE quiet status line
              (RunStatusLine above) covers the pre-stream working state and
              vanishes the instant reasoning or text tokens land. */}
        </div>

        {/* jump-to-latest — glass pill with the count of lines that landed
            while the user was scrolled away; honors reduce-motion */}
        {!atBottom && messages.length > 0 && (
          <div className="absolute inset-x-0 bottom-2 flex justify-center pointer-events-none z-10">
            <button className="rp-jump pointer-events-auto anim-in" onClick={jumpToLatest}>
              <ArrowDown size={12} className="shrink-0" />
              <span className="whitespace-nowrap">{t('chat.jumpLatest', 'Jump to latest')}</span>
              {pendingLines > 0 && (
                <span className="rp-jump-count tnum" dir="ltr">
                  {pendingLines > 99 ? '99+' : `+${pendingLines}`}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* ---------- live plan + pending approval + DNA suggestion ---------- */}
      <div className="shrink-0">
        <DnaSuggestionCard />
        {todos.length > 0 && (
          <div className="px-3 pb-1.5">
            <PlanCard todos={todos} />
          </div>
        )}

        {showApproval && pendingApproval && isDoomLoop && (
          // ---------- doom-loop dialog (special-cased copy) ----------
          <div className="px-3 pb-2">
            <div
              className="approval-card approval-card-v13 spec-ring p-3 anim-in msg-in"
              role="alertdialog"
              aria-label={t('chat.doom.title', 'Repeating tool call detected')}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Repeat size={14} className="text-warn shrink-0" />
                <span className="text-[var(--chat-ui)] font-semibold" dir="auto">
                  {t('chat.doom.title', 'Repeating tool call detected')}
                </span>
              </div>
              <div className="flex items-center gap-2 mb-2 min-w-0">
                <span className="stamp stamp-warn max-w-[24ch] truncate" dir="ltr" title={pendingApproval.toolName ?? ''}>
                  {pendingApproval.toolName ?? t('tool.mcp', 'tool')}
                </span>
                <span className="font-code tnum text-[12px] text-faint" dir="ltr">
                  ×3
                </span>
                <span className="text-[12px] text-faint truncate min-w-0">
                  {t('chat.doom.body', 'the engine paused before repeating the same call again')}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Btn variant="primary" className="flex-1 !h-7 !px-1.5 !text-[12px]" onClick={() => void decideApproval('allow')}>
                  <span className="truncate">{t('chat.allowOnce')}</span>
                  <Kbd className="!h-[15px] !px-1 !text-[12px] shrink-0">↵</Kbd>
                </Btn>
                <Btn className="flex-1 !h-7 !px-1.5 !text-[12px]" onClick={() => void decideApproval('always')}>
                  <span className="truncate">{t('chat.doom.always', 'ALWAYS THIS TOOL')}</span>
                  <Kbd className="!h-[15px] !px-1 !text-[12px] shrink-0">A</Kbd>
                </Btn>
                <Btn variant="danger" className="flex-1 !h-7 !px-1.5 !text-[12px]" onClick={() => void decideApproval('deny')}>
                  <span className="truncate">{t('chat.doom.stop', 'STOP')}</span>
                  <Kbd className="!h-[15px] !px-1 !text-[12px] shrink-0">⌫</Kbd>
                </Btn>
              </div>
            </div>
          </div>
        )}

        {showApproval && pendingApproval && isQuestion && (
          // ---------- v3.1 ask_user — question card: choice buttons (1-4 keys
          // work too) + optional free-text answer. NO allow/deny for questions. ----------
          <div className="px-3 pb-2">
            <div className="approval-card approval-card-v13 spec-ring p-3 anim-in msg-in">
              <div className="flex items-center gap-2 mb-1.5">
                <MessageSquare size={14} className="text-acc shrink-0" />
                <span className="text-[var(--chat-ui)] font-semibold truncate" dir="auto">
                  {pendingApproval.title || t('chat.ask.title', 'Question')}
                </span>
              </div>
              <div className="text-[var(--chat-ui)] text-dim whitespace-pre-wrap break-words mb-2" dir="auto">
                {pendingApproval.detail}
              </div>
              {(pendingApproval.choices ?? []).length > 0 && (
                <div className="flex flex-col gap-1.5 mb-2">
                  {(pendingApproval.choices ?? []).map((choice, i) => (
                    <Btn
                      key={`${i}:${choice}`}
                      variant={i === 0 ? 'primary' : 'default'}
                      className="!h-7 !px-2 !text-[12px] !justify-start"
                      onClick={() => void decideApproval('answer', choice)}
                    >
                      <Kbd className="!h-[15px] !px-1 !text-[12px] shrink-0">{i + 1}</Kbd>
                      <span className="truncate" dir="auto">
                        {choice}
                      </span>
                    </Btn>
                  ))}
                </div>
              )}
              {pendingApproval.allowText !== false && (
                <div className="flex items-center gap-1.5">
                  <TextInput
                    autoFocus
                    dir="auto"
                    value={answerDraft}
                    onChange={(e) => setAnswerDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && answerDraft.trim()) {
                        e.preventDefault();
                        submitAnswer();
                      }
                    }}
                    placeholder={t('chat.ask.placeholder', 'Type an answer…')}
                    aria-label={t('chat.ask.placeholder', 'Type an answer…')}
                    className="flex-1 min-w-0 !h-7 !text-[12px] !px-2"
                  />
                  <Btn
                    variant="primary"
                    className="!h-7 !px-2.5 !text-[12px] shrink-0"
                    disabled={!answerDraft.trim()}
                    onClick={submitAnswer}
                  >
                    {t('chat.ask.send', 'SEND')}
                  </Btn>
                </div>
              )}
            </div>
          </div>
        )}

        {showApproval && pendingApproval && !isDoomLoop && !isQuestion && (
          <div className="px-3 pb-2">
            <div className="approval-card approval-card-v13 spec-ring p-3 anim-in msg-in">
              <div className="flex items-center gap-2 mb-1.5">
                <ShieldAlert size={14} className="text-warn shrink-0" />
                <span className="text-[var(--chat-ui)] font-semibold truncate" dir="auto">
                  {pendingApproval.title}
                </span>
              </div>
              <pre
                dir="ltr"
                className="select-text font-code text-[12px] max-h-32 overflow-auto bg-[var(--bg2)] rounded-[4px] p-2 border border-line whitespace-pre-wrap break-words mb-2"
              >
                {pendingApproval.detail}
              </pre>
              {pendingApproval.kind === 'command' && (
                <div className="flex items-center gap-1.5 mb-2">
                  <TextInput
                    dir="ltr"
                    value={scopeDraft}
                    onChange={(e) => setScopeDraft(e.target.value)}
                    placeholder={t('chat.approvalScope', 'remember as (editable scope)…')}
                    aria-label={t('chat.approvalScope', 'remember as (editable scope)…')}
                    className="flex-1 min-w-0 !h-7 !text-[12px] !px-2 font-code"
                  />
                  <span className="text-[12px] text-ghost shrink-0 uppercase tracking-wider">
                    {t('chat.approvalScopeHint', 'scope')}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-3 gap-1.5">
                <Btn
                  variant="primary"
                  className="!h-7 !px-1.5 !text-[12px] col-span-2"
                  onClick={() => void decideApproval('allow')}
                >
                  <span className="truncate">{t('chat.allowOnce')}</span>
                  <Kbd className="!h-[15px] !px-1 !text-[12px] shrink-0">↵</Kbd>
                </Btn>
                <Btn
                  variant="danger"
                  className="!h-7 !px-1.5 !text-[12px]"
                  onClick={() => void decideApproval('deny')}
                >
                  <span className="truncate">{t('chat.deny')}</span>
                  <Kbd className="!h-[15px] !px-1 !text-[12px] shrink-0">⌫</Kbd>
                </Btn>
                <Btn
                  className="!h-7 !px-1.5 !text-[12px]"
                  onClick={() => void decideApproval('always', scopeDraft.trim() || undefined)}
                >
                  <span className="truncate">{t('chat.approveAlways')}</span>
                  <Kbd className="!h-[15px] !px-1 !text-[12px] shrink-0">A</Kbd>
                </Btn>
                <Btn
                  className="!h-7 !px-1.5 !text-[12px]"
                  onClick={() => void decideApproval('always_session', scopeDraft.trim() || undefined)}
                >
                  <span className="truncate">{t('chat.approveSession', 'THIS SESSION')}</span>
                </Btn>
                <Btn
                  variant="danger"
                  className="!h-7 !px-1.5 !text-[12px]"
                  onClick={() => void decideApproval('never', scopeDraft.trim() || undefined)}
                >
                  <span className="truncate">{t('chat.rejectAlways', 'ALWAYS REJECT')}</span>
                  <Kbd className="!h-[15px] !px-1 !text-[12px] shrink-0">N</Kbd>
                </Btn>
              </div>
            </div>
          </div>
        )}

        {/* ---------- v2.4 flows suggestion ---------- */}
        <FlowSuggest />
      </div>

      {/* ---------- composer (control deck) ---------- */}
      <Composer />
    </div>
  );
}

// v2.4 — appears when flowsService detects a repeated request (≥3 times):
// one click saves it as a reusable one-click Flow.
function FlowSuggest() {
  const t = useT();
  const flowSuggest = useStore((s) => s.flowSuggest);
  const dismissFlowSuggest = useStore((s) => s.dismissFlowSuggest);
  const notify = useStore((s) => s.notify);
  const [saving, setSaving] = useState(false);
  if (!flowSuggest || saving) return null;
  const save = async () => {
    setSaving(true);
    try {
      const bridge = api as unknown as {
        flowsSave?: (f: { name: string; prompt: string; scope: 'global' | 'workspace' }) => Promise<unknown>;
      };
      if (typeof bridge.flowsSave === 'function') {
        const name = flowSuggest.text.replace(/\s+/g, ' ').trim().slice(0, 40);
        await bridge.flowsSave({ name, prompt: flowSuggest.text, scope: 'global' });
        notify(t('flows.saved', 'Flow saved'));
      }
      dismissFlowSuggest();
    } catch {
      /* service unavailable — dismiss quietly */
      dismissFlowSuggest();
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flow-suggest glass grain msg-in" dir="auto" role="status">
      <div className="flow-suggest-txt">
        <div className="flow-suggest-tt">{t('flows.suggest.title', 'Turn this into a flow?')}</div>
        <div className="flow-suggest-body">{t('flows.suggest.body', 'You have asked for this several times. Save it as a one-click flow?')}</div>
      </div>
      <div className="flow-suggest-act">
        <Btn variant="primary" className="!h-7 !px-2.5 !text-[12px] press" onClick={() => void save()}>
          {t('flows.suggest.save', 'Save as flow')}
        </Btn>
        <IconBtn
          title={t('flows.suggest.later', 'Not now')}
          aria-label={t('flows.suggest.later', 'Not now')}
          onClick={dismissFlowSuggest}
        >
          <span aria-hidden>✕</span>
        </IconBtn>
      </div>
    </div>
  );
}

export default ChatPanel;
