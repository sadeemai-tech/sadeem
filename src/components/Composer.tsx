// Composer — the agent control deck (SURVEYOR v4).
// Top strip: taskMode .stamp-seg (BUILD/PLAN/DEBUG/REVIEW → engine task mode),
// steer-pending / queued-count stamps. Queued items render as dismissible
// chips above the input. Auto-growing textarea, '/' slash menu, image
// attachments, mic voice input (whisper via the active provider), square ctx +
// model chips (.tnum), .ibtn stop, and send. v11.43 — file mentions are now
// picked from the "+" popover (AttachMenu); the floating '@' list that used to
// hover over the middle of the chat panel was retired.
//
// Keyboard: idle → Enter sends · Shift+Enter newline.
//           running → Enter queues · Shift+Enter STEERS (agentSteer, amber).
//
// A module-level `composerBridge` lets the surrounding ChatPanel route
// panel-level drops into the same attach logic.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookMarked, Check, CornerDownLeft, Mic, Search, X, MessageSquare } from 'lucide-react';
import { IcFile, IcSend, IcSpark, IcStop } from './icons';
import type { ChatMessage, PermissionMode, SlashCommandInfo, TaskMode } from '../../shared/types';
import { useStore } from '../store';
import type { RailView } from '../store';
import {
  PERMISSION_MODES,
  TASK_MODES,
  TASK_MODE_DESC,
  nextIn,
  isSlashMenuQuery,
  type SlashAction,
  type SlashGroup,
} from '../lib/modes';
import { api } from '../lib/api';
import type { TranscribeResult } from '../lib/api';
import { filterPromptPresets, presetPreview, type PromptPresetLike } from '../lib/promptPresets';
import { makeT, useT } from '../i18n';
import { Chip, shortModel, Spinner } from './ui';
import { ContextLens } from './ContextLens';
import { WorktreeChip } from './WorktreeChip';
// v11.37 — the three toolbar buttons (image / prompt presets / rewind) are
// gathered behind ONE "+" menu; effort becomes a real draggable chat control.
import { AttachMenu } from './AttachMenu';
import { EffortControl } from './EffortControl';
import { phaseOfTool, PROVE_ROW_MODELS, type StreamPhase } from './StreamTimeline';
import './subagents.css';
import './chat-final.css';
import './voice-input.css';

const MAX_TA_HEIGHT = 180;
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // spec cap: 5 MB per image
const MAX_MENTION_FILES = 200;
// v11.37 — document picker accepted types. Documents use the EXISTING shared
// attach path (attachFiles → @path mention); there is no fabricated store
// channel for document bytes. See docs/CHAT-CONTROLS-V1137.md (handoff).
const DOC_ACCEPT = [
  '.pdf', '.doc', '.docx', '.txt', '.md', '.markdown', '.rtf', '.csv',
  '.json', '.xml', '.yaml', '.yml', '.html', '.htm', '.xls', '.xlsx',
  '.ppt', '.pptx', '.log', '.tsv',
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
].join(',');

// v11.4 — voice capture records 16 kHz mono PCM WAV by default: GLM-ASR
// (zai/zhipu) accepts ONLY WAV/MP3, and WAV is accepted by every OpenAI-
// compatible transcription route. MediaRecorder/WebM survives only for the
// families whose ASR endpoint is known to parse WebM/Opus.
const PCM_TARGET_RATE = 16000;
const WEBM_ASR_FAMILIES = new Set(['openai', 'groq', 'openrouter', 'moonshot', 'mistral', 'qwen']);

const TASK_MODE_KEY: Record<TaskMode, string> = {
  build: 'comp.mode.build',
  plan: 'comp.mode.plan',
  debug: 'comp.mode.debug',
  review: 'comp.mode.review',
};

/**
 * TASK A — deterministic mode-chip sizing (the "المربع مش واسع" fix).
 *
 * The strip used to size each chip to its own label. The ACTIVE chip also
 * renders a check glyph, so it grew wider than its neighbours; in an RTL row
 * that pushed the segment out of alignment and clipped/overlapped the content
 * below it. Measure the longest localized label across BOTH EN and AR, reserve
 * a fixed check slot on EVERY chip, and hand all four chips one shared
 * min-width + height so selection never changes the geometry. Pure function —
 * also asserted by the deterministic source tests.
 */
export function modeChipMinWidthPx(): number {
  let widest = 0;
  for (const lang of ['en', 'ar'] as const) {
    const tt = makeT(lang);
    for (const m of TASK_MODES) {
      const label = tt(TASK_MODE_KEY[m], m.toUpperCase());
      let units = 0;
      for (const ch of label) units += /[\u0600-\u06FF]/.test(ch) ? 10 : 8; // mono caps ≈ 0.62em @ 13px, Arabic joined forms slightly wider
      widest = Math.max(widest, units);
    }
  }
  // 11px check slot + 4px gap + 8px×2 inline padding + 2px safety.
  return Math.ceil(Math.max(64, widest + 33));
}

/** Mono slash-command hint row (fills the input on click). */
const QUICK_COMMANDS = ['/plan', '/review', '/init', '/compact', '/model', '/settings'];

/**
 * Minimal "use N agents" composer chips — insert an UNAMBIGUOUS instruction
 * that makes the agent launch N `task` calls (one per specialist) so the
 * agent-team card renders a chip per agent. Kept as plain text so the user can
 * edit it; no hidden state, no auto-send.
 */
const AGENT_TEAM_PROMPTS: Record<2 | 3, string> = {
  2: 'Use 2 specialist subagents via the task tool — delegate one to the explore (Codebase Explorer) agent and one to the review (Code Reviewer) agent, then combine their findings.',
  3: 'Use 3 specialist subagents via the task tool — one explore (Codebase Explorer) to map the code, one implement (Implementer) to make the change, and one test (Test Engineer) to verify it — then combine their results.',
};

/** Read an image File into a data URL (null when not an image). */
function fileToDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) return resolve(null);
    const fr = new FileReader();
    fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(file);
  });
}

/** Blob → bare base64 payload ('' when unreadable) — feeds api.transcribeAudio. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => {
      const r = typeof fr.result === 'string' ? fr.result : '';
      const i = r.indexOf(',');
      resolve(i >= 0 ? r.slice(i + 1) : '');
    };
    fr.onerror = () => resolve('');
    fr.readAsDataURL(blob);
  });
}

/** 75 → "1:15" for the mono recording timer (RTL-safe via dir="ltr"). */
function fmtSecs(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** v11.4 — average-reduce Float32 mono audio down to 16 kHz (pure JS). */
function downsampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate <= PCM_TARGET_RATE || fromRate <= 0) return input;
  const ratio = fromRate / PCM_TARGET_RATE;
  const outLen = Math.max(0, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

/**
 * v11.4 — Float32 mono chunks → 16 kHz mono 16-bit PCM WAV Blob (audio/wav).
 * Rendered entirely in the renderer (no native deps): the canonical 44-byte
 * RIFF header + little-endian PCM, which every transcription endpoint parses.
 */
function float32ToWavBlob(chunks: Float32Array[], sampleRate: number): Blob {
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  const rate = sampleRate > PCM_TARGET_RATE ? PCM_TARGET_RATE : Math.max(1, Math.floor(sampleRate || PCM_TARGET_RATE));
  const data = downsampleTo16k(merged, sampleRate);
  const dataSize = data.length * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true); // sample rate
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  let p = 44;
  for (let i = 0; i < data.length; i++, p += 2) {
    const s = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * v2.6 RTL — bidi-safe textarea placeholder.
 * The AR placeholder ("اكتب مهمة، @ذكر ملفات، /أوامر…") mixes Arabic prose
 * with literal '@'/'/' sigils. In an RTL paragraph the UBA resolves those
 * neutral sigils into the surrounding Arabic run, so the slash detaches and
 * floats to the wrong end of its word ("أوامر/"). Gluing an RLM (U+200F) to
 * each sigil makes it strong-RTL, keeping it attached to the Arabic token it
 * introduces in every paragraph direction. Latin-only strings (EN placeholder,
 * runHint) are untouched — no Arabic script → no-op.
 */
function rtlSafePlaceholder(s: string): string {
  if (!/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(s)) return s;
  return s.replace(/([@/])/g, '\u200F$1\u200F');
}

/**
 * Live bridge between panel-level drag-drop (ChatPanel) and the composer's
 * attachment state. Composer registers the handler on mount and clears it on
 * unmount — no React context needed.
 */
export const composerBridge: { attachFiles: ((files: FileList | File[] | null) => void) | null } = {
  attachFiles: null,
};

// v11.9 — custom slash commands (user ~/.surnia/commands/*.md + workspace
// <ws>/.surnia/commands/*.md, from kdx:agent:slashCommands). The slash menu
// fetches them on mount/focus; a module-level cache (30s TTL) keeps repeated
// opens instant and shared across composer mounts. Any failure → [] silently.
const CUSTOM_SLASH_TTL_MS = 30_000;
let customSlashCache: { at: number; ws: string; cmds: SlashCommandInfo[] } | null = null;
async function loadCustomSlashCommands(ws: string, force = false): Promise<SlashCommandInfo[]> {
  const now = Date.now();
  if (!force && customSlashCache && customSlashCache.ws === ws && now - customSlashCache.at < CUSTOM_SLASH_TTL_MS) {
    return customSlashCache.cmds;
  }
  let cmds: SlashCommandInfo[] = [];
  try {
    const res = await api.slashCommands(ws || undefined);
    if (Array.isArray(res)) cmds = res;
  } catch {
    /* bridge missing or main busy — the menu just shows built-ins */
  }
  customSlashCache = { at: now, ws, cmds };
  return cmds;
}

/** v11.26 — SlashAction / SlashGroup now live in lib/modes (ONE source of
 *  truth with the advertised-command registry + the proof test). */

/** v10.3 — Codex-style grouped slash registry (group headers + arg hints).
 *  v11.9 — adds the 'custom' group (user/workspace markdown commands). */
const SLASH_GROUPS: { id: SlashGroup; en: string; ar: string }[] = [
  { id: 'session', en: 'Session', ar: 'الجلسة' },
  { id: 'context', en: 'Context', ar: 'السياق' },
  { id: 'build', en: 'Build & review', ar: 'البناء والمراجعة' },
  { id: 'agent', en: 'Agent', ar: 'الوكيل' },
  { id: 'app', en: 'App', ar: 'التطبيق' },
  { id: 'panels', en: 'Panels', ar: 'اللوحات' },
  { id: 'custom', en: 'Custom commands', ar: 'أوامر مخصصة' },
];
interface SlashCmd {
  cmd: string;
  desc: string;
  action: SlashAction;
  group: SlashGroup;
  /** Placeholder for the argument the command expects (right-aligned hint). */
  arg?: string;
  /** Optional rail to open (action === 'panel'). */
  panel?: RailView;
  /** Optional settings section id (action === 'settings'). */
  section?: string;
  /** For action === 'taskmode': the BUILD/PLAN/DEBUG/REVIEW stamp to set. */
  taskMode?: TaskMode;
}
interface MentionItem {
  rel: string;
  dir: boolean;
}

type SlashT = ReturnType<typeof makeT>;

/**
 * v11.26 — localized labels for the canonical SLASH_COMMANDS registry.
 * Kept here (not in lib/modes.ts) because translation belongs to the Composer;
 * the registry owns only the command → handler contract. Every registered
 * command MUST have a case here, otherwise the menu would show a blank row.
 */
function slashDescription(cmd: string, t: SlashT, ar: boolean, nextMode: PermissionMode): string {
  switch (cmd) {
    case '/clear': return t('sess.new', 'New session');
    case '/compact': return t('palette.compact', 'Summarize and compact context');
    case '/rewind': return t('palette.rewind', 'Restore the last checkpoint');
    case '/undo': return t('slash.undo.desc', 'Undo — restore the newest checkpoint');
    case '/continue': return t('slash.continue.desc', 'Continue the last task from where it stopped');
    case '/fork': return t('palette.fork', '/fork — fork this session');
    case '/export': return t('palette.export', '/export — download session as Markdown');
    case '/goal': return t('palette.goal', '/goal — set & track an agent goal');
    case '/schedule': return t('palette.schedule', '/schedule — scheduled agent jobs');
    case '/handoff': return t('slash.handoff.desc', ar ? 'مذكرة تسليم الجلسة (HANDOFF.md) للمتابعة لاحقاً' : 'Session handoff note (HANDOFF.md) for resuming later');
    case '/init': return t('palette.init', 'Generate project memory (MEMORY.md)');
    case '/context': return t('palette.context', 'Context window breakdown');
    case '/cost': return t('usage.session', 'This session');
    case '/dna': return t('palette.dnaLearned', 'What has SADEEM learned?');
    case '/build': return ar ? 'وضع البناء — تنفيذ كامل مع تحقق بالاختبارات' : 'BUILD — full execution with test verification';
    case '/plan': return t('tb.mode.plan.desc', 'Plan mode: read-only research, then a plan');
    case '/debug': return ar ? 'وضع الفحص — فرضية ثم اختبار مع حلقة تحقق تلقائية' : 'DEBUG — hypothesis → test with an automatic verify loop';
    case '/review': return t('palette.review', '/review — AI review of pending changes');
    case '/tests': return t('slash.tests.desc', 'Generate tests for a file');
    case '/diff': return t('slash.cmd.diff.desc', 'Show a unified diff of uncommitted changes (optional path)');
    case '/test': return t('slash.cmd.test.desc', 'Run the test command with a real exit-code verdict');
    case '/explain': return t('slash.cmd.explain.desc', 'Read a file and explain it in your language');
    case '/commit': return t('palette.commit', '/commit — AI-suggested commit message');
    case '/pr': return t('slash.pr.desc', 'Draft a PR description from your changes');
    case '/grill': return t('slash.grill.desc', ar ? 'مقابلة أسئلة قبل البرمجة (خيارات موصى بها)' : 'Interview me before coding (recommended options first)');
    case '/changelog': return t('slash.changelog.desc', 'Release notes from recent commits');
    case '/flows': return t('slash.flows.desc', 'Manage one-click flows');
    case '/effort': return t('palette.effort', 'Toggle deep thinking effort');
    case '/model': return t('slash.model.desc', 'Switch the active model');
    case '/profile': return t('slash.profile.desc', 'Switch the tool profile');
    case '/mode': return t(`palette.mode.${nextMode}`, `Permission mode: ${nextMode}`);
    case '/budget': return t('slash.cmd.budget.desc', 'Show real token and cost totals for this session');
    case '/settings': return ar ? 'افتح الإعدادات' : 'Open Settings';
    case '/theme': return t('settings.theme', 'Theme');
    case '/lang': return t('palette.lang', 'Toggle language AR/EN');
    case '/plans': return t('palette.openPlans', 'Plans & upgrade');
    case '/terminal': return t('palette.toggleTerminal', 'Toggle terminal');
    case '/help': return t('help.title', 'SADEEM commands');
    case '/git': return ar ? 'التحكم بالمصدر' : 'Source control';
    case '/mcp': return t('slash.cmd.mcp.desc', 'List MCP servers or test one by id');
    case '/skills': return t('slash.cmd.skills.desc', 'Toggle skill injection or list workspace skills');
    case '/usage': return ar ? 'الاستخدام والتكلفة' : 'Usage & cost';
    case '/library': return ar ? 'مكتبة المخرجات' : 'Output library';
    case '/prompts': return ar ? 'مكتبة التوجيهات القابلة لإعادة الاستخدام' : 'Reusable prompt library';
    default: return cmd;
  }
}

/** Argument placeholder for an arg-taking command (right-aligned hint). */
function slashArgHint(cmd: string, t: SlashT, ar: boolean): string {
  switch (cmd) {
    case '/goal': return t('slash.arg.goal', 'objective');
    case '/tests': return 'file';
    case '/diff': return t('slash.arg.path', 'path');
    case '/test': return t('slash.arg.command', 'command');
    case '/explain': return t('slash.arg.file', 'file');
    case '/grill': return t('slash.arg.topic', ar ? 'الموضوع' : 'topic');
    case '/model': return t('slash.arg.model', 'model name');
    case '/profile': return t('slash.arg.profile', 'essential|balanced|full');
    case '/mcp': return t('slash.arg.mcpid', 'list|test <id>');
    case '/skills': return t('slash.arg.skill', 'on|off|list');
    default: return '';
  }
}

// Flatten the workspace FileNode tree into relative paths (files + dirs), capped.
function flattenTree(
  node: { path: string; type: 'file' | 'dir'; children?: unknown[] },
  wsPath: string,
  out: MentionItem[],
): void {
  if (out.length >= MAX_MENTION_FILES) return;
  const rel = node.path.startsWith(`${wsPath}/`) ? node.path.slice(wsPath.length + 1) : node.path;
  out.push({ rel, dir: node.type === 'dir' });
  if (node.type === 'dir' && Array.isArray(node.children)) {
    for (const c of node.children as { path: string; type: 'file' | 'dir'; children?: unknown[] }[]) {
      flattenTree(c, wsPath, out);
    }
  }
}

const NO_RUN_MESSAGES: ChatMessage[] = [];
const RUN_PHASE_ORDER: StreamPhase[] = ['think', 'work', 'build', 'run', 'prove'];

/**
 * FINAL POLISH — the composer's run-progress strip is driven ONLY by the real
 * transcript (the same phase grammar StreamTimeline / RunStatusLine use):
 * unresolved tool_call → active phase, matching tool_result → done, prove-
 * family rows → prove done, streaming tail → think. No timers, no percentages.
 */
function useRunProgressSteps(): { state: 'done' | 'active' | 'pending'; phase: StreamPhase }[] | null {
  const running = useStore((s) => s.running);
  const msgs = useStore((s) => s.session?.messages ?? NO_RUN_MESSAGES);

  const startRef = useRef(Date.now());
  const prevRef = useRef(running);
  if (running !== prevRef.current) {
    prevRef.current = running;
    if (running) startRef.current = Date.now();
  }
  if (!running) return null;

  const resolved = new Set<string>();
  for (const m of msgs) if (m.kind === 'tool_result' && m.toolCallId) resolved.add(m.toolCallId);
  const done: Record<StreamPhase, boolean> = { think: false, work: false, build: false, run: false, prove: false };
  // v11.31 — this ledger now folds the SAME per-phase grammar as ChatPanel's
  // deriveRunPhases (one source of truth, two strips). A single `active`
  // variable could only light ONE dot: with a streaming answer AND a pending
  // tool it marked THINK "pending" while the chat strip marked it "active".
  // Track active per phase so both strips agree; done still wins over active
  // for any one phase, exactly as in the chat strip.
  const activeSet: Record<StreamPhase, boolean> = { think: false, work: false, build: false, run: false, prove: false };
  let counted = 0;
  for (const m of msgs) {
    if (m.timestamp < startRef.current) continue;
    counted++;
    if (m.kind === 'tool_call') {
      const p = phaseOfTool(m.toolName);
      if (m.toolCallId && resolved.has(m.toolCallId)) done[p] = true;
      else activeSet[p] = true;
    } else if (m.role === 'assistant') {
      if (m.model && PROVE_ROW_MODELS.has(m.model)) done.prove = true;
      else if (m.streaming) activeSet.think = true;
      else done.think = true;
    }
  }
  // Right after send (no engine row yet) THINK is active in BOTH strips.
  if (counted === 0) activeSet.think = true;
  return RUN_PHASE_ORDER.map((phase) => ({
    phase,
    state: activeSet[phase] ? 'active' : done[phase] ? 'done' : 'pending',
  }));
}

/* ============================================================
 * Voice input — presentational core (stable / unversioned).
 * Styled by voice-input.css. Pure props → markup: no store, no timers,
 * no Web Audio calls, no pseudo-random values — safe under renderToString.
 * Every moving value is either a REAL analyser level passed by the parent
 * or a fixed, clearly-labelled steady fallback.
 * ============================================================ */
export type VoiceUiState = 'idle' | 'listening' | 'processing' | 'result';

export interface VoiceLabels {
  idle: string;
  listening: string;
  processing: string;
  result: string;
  stop: string;
  /** Honest hint shown when NO amplitude API exists (steady pulse). */
  steady: string;
}

export interface VoiceInputProps {
  state: VoiceUiState;
  /** Real normalised RMS level 0..1 from a Web Audio AnalyserNode. */
  level?: number;
  /** True only when `level` is backed by a live analyser. */
  hasAmplitude?: boolean;
  seconds?: number;
  /** Final transcript returned by the transcription API (never fabricated). */
  transcript?: string;
  labels: VoiceLabels;
  onStart: () => void;
  onStop: () => void;
}

const VI_BARS = 28; // fixed tick count → deterministic, SSR-stable markup

/** Deterministic tick length (no randomness) — amplitude × fixed per-tick shape. */
function viBarLen(i: number, level: number): number {
  const shape = 0.55 + 0.45 * Math.abs(Math.sin(i * 1.7 + 0.6));
  return 1.4 + level * 5.2 * shape;
}

export function VoiceInput({
  state,
  level = 0,
  hasAmplitude = false,
  seconds = 0,
  transcript = '',
  labels,
  onStart,
  onStop,
}: VoiceInputProps) {
  const live = state === 'listening';
  // With a real analyser the ring follows the measured level. Without one it
  // is a fixed, subtle 0.16 — never a simulated "voice" waveform.
  const amp = hasAmplitude ? Math.max(0, Math.min(1, level)) : 0.16;
  const status =
    state === 'listening'
      ? labels.listening
      : state === 'processing'
        ? labels.processing
        : state === 'result'
          ? labels.result
          : labels.idle;
  const bars: React.ReactNode[] = [];
  for (let i = 0; i < VI_BARS; i++) {
    const a = (i / VI_BARS) * Math.PI * 2 - Math.PI / 2;
    const len = viBarLen(i, amp);
    const x1 = 24 + Math.cos(a) * 16;
    const y1 = 24 + Math.sin(a) * 16;
    const x2 = 24 + Math.cos(a) * (16 + len);
    const y2 = 24 + Math.sin(a) * (16 + len);
    bars.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />);
  }
  return (
    <span
      className="vi-root"
      data-state={state}
      data-has-amplitude={hasAmplitude ? 'true' : 'false'}
      style={{ '--vi-level': amp } as React.CSSProperties}
    >
      <button
        type="button"
        className="vi-mic"
        onClick={live ? onStop : onStart}
        disabled={state === 'processing'}
        aria-pressed={live}
        aria-label={live ? labels.stop : labels.idle}
        title={live ? labels.stop : labels.idle}
      >
        <svg className="vi-wave" viewBox="0 0 48 48" aria-hidden="true">
          <circle className="vi-wave-track" cx="24" cy="24" r="20" />
          <g className="vi-wave-bars">{bars}</g>
        </svg>
        <span className="vi-core" aria-hidden="true">
          {state === 'processing' ? (
            <Spinner size={12} />
          ) : state === 'result' ? (
            <Check size={13} strokeWidth={2.4} />
          ) : (
            <Mic size={13} />
          )}
        </span>
      </button>

      {state !== 'idle' && (
        <span className="vi-pop" role="status" aria-live="polite">
          <span className="vi-orb" aria-hidden="true"><i /><i /><i /></span>
          <span className="vi-pop-body">
            <span className="vi-status" dir="auto">{status}</span>
            {live && <span className="vi-timer tnum" dir="ltr">{fmtSecs(seconds)}</span>}
            {!hasAmplitude && live && <span className="vi-honest" dir="auto">{labels.steady}</span>}
            {transcript && <span className="vi-transcript" dir="auto">{transcript}</span>}
          </span>
        </span>
      )}
    </span>
  );
}

export function Composer() {
  const t = useT();
  const running = useStore((s) => s.running);
  const queuedCount = useStore((s) => s.queuedCount);
  const queuedItems = useStore((s) => s.queuedItems);
  const dismissQueued = useStore((s) => s.dismissQueued);
  // v6 — pending artifact comments (ride with the next message)
  const artifactComments = useStore((s) => s.artifactComments);
  const clearArtifactComments = useStore((s) => s.clearArtifactComments);
  const steerPending = useStore((s) => s.steerPending);
  const taskMode = useStore((s) => s.taskMode);
  // v11.31 — the composer's old straight "square context meter" was replaced
  // by the single radial ContextLens orb. Its store slices (sessionUsage,
  // lastTurnUsage, ctxWindow) and the derived fill/pct/tonal variables below
  // were dead subscriptions + dead math; the orb owns the real fill now. Only
  // liveStreamChars is still read — by the send-phase engine-event latch.
  const fileTree = useStore((s) => s.fileTree);
  const wsPath = useStore((s) => s.wsPath);
  const lang = useStore((s) => s.settings.language);
  const mode = useStore((s) => s.settings.permissionMode);
  const model = useStore((s) => s.settings.model);
  const sendMessage = useStore((s) => s.sendMessage);
  const sendSteer = useStore((s) => s.sendSteer);
  const setTaskMode = useStore((s) => s.setTaskMode);
  const abortAgent = useStore((s) => s.abortAgent);
  const setModelPicker = useStore((s) => s.setModelPicker);
  const setPlans = useStore((s) => s.setPlans);
  const setMode = useStore((s) => s.setMode);
  const setLang = useStore((s) => s.setLang);
  const cycleTheme = useStore((s) => s.cycleTheme);
  const setScheduled = useStore((s) => s.setScheduled);
  const setRail = useStore((s) => s.setRail);
  const setSettingsModal = useStore((s) => s.setSettings);
  const composerInsert = useStore((s) => s.composerInsert);
  const notify = useStore((s) => s.notify);
  // v11.13 — captured output of the last real slash capability (copyable panel)
  const capabilityPanel = useStore((s) => s.capabilityPanel);
  const dismissCapabilityPanel = useStore((s) => s.dismissCapabilityPanel);
  // v12 — prompt presets quick insert + checkpoint rewind, both reachable
  // from the composer without leaving the chat surface.
  const insertIntoComposer = useStore((s) => s.insertIntoComposer);
  const openRewindPicker = useStore((s) => s.openRewindPicker);
  // v11.12 — Continue chip: offered only when the last turn actually ended
  // early (truncated / compaction / error). The store owns the decision.
  const continueHint = useStore((s) => s.continueHint);
  const continueTask = useStore((s) => s.continueTask);
  // v11.4 — voice prefs (mic device pick + auto-send) read straight from settings
  const voicePrefs = useStore((s) => s.settings.voice);
  const voiceDeviceId = String(voicePrefs?.deviceId ?? '');
  const voiceAutoSend = voicePrefs?.autoSend === true;

  const [value, setValue] = useState('');
  const [imgs, setImgs] = useState<string[]>([]);
  const [suppressed, setSuppressed] = useState<'slash' | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  // v12 — prompt-presets quick-insert popover (lazy-loaded library + filter)
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [presets, setPresets] = useState<PromptPresetLike[]>([]);
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [presetQuery, setPresetQuery] = useState('');
  const presetsRef = useRef<HTMLDivElement>(null);
  // voice input: idle → listening → processing → result → idle.
  // UI state names are the public ones; the capture engine keeps its own
  // `recording`/`busy` vocabulary (mapped in the JSX below).
  const [voice, setVoice] = useState<'idle' | 'recording' | 'busy' | 'result'>('idle');
  const [voiceSecs, setVoiceSecs] = useState(0);
  /** Final transcript shown briefly in the result preview (API final only). */
  const [voiceResultText, setVoiceResultText] = useState('');
  /** Real normalised RMS amplitude 0..1 from a Web Audio AnalyserNode. */
  const [voiceLevel, setVoiceLevel] = useState(0);
  /** True only while a real analyser feeds `voiceLevel`. */
  const [voiceLevelAvailable, setVoiceLevelAvailable] = useState(false);
  const voiceResultTimerRef = useRef<number | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // v11.37 — separate document picker; routes to the SAME attachFiles path.
  const docRef = useRef<HTMLInputElement>(null);
  const lastInsertSeq = useRef(0);
  const dragDepth = useRef(0);

  // Minimal agent-team quick insert — appends a clear delegation instruction
  // to whatever the user already typed (never sends, never clears their text).
  const insertAgentTeam = (count: 2 | 3) => {
    const instruction = AGENT_TEAM_PROMPTS[count];
    setValue((cur) => (cur.trim() ? `${cur.replace(/\s+$/, '')} ${instruction}` : instruction));
    setSuppressed('slash');
    setActiveIdx(0);
    taRef.current?.focus();
  };
  const voiceRecRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef = useRef<number | null>(null);
  // v11.4 — PCM capture graph (AudioContext → ScriptProcessor → Float32 chunks)
  const voiceCtxRef = useRef<AudioContext | null>(null);
  const voiceSrcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const voiceProcRef = useRef<ScriptProcessorNode | null>(null);
  const voicePcmRef = useRef<Float32Array[] | null>(null);
  // Waveform ring: a REAL analyser tap (no timers, no random data).
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceLevelBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const voiceLevelRafRef = useRef<number | null>(null);
  // WebM path capture has no AudioContext of its own — this silent analysis-
  // only context is created there and closed with the rest of the mic graph.
  const voiceAnalysisCtxRef = useRef<AudioContext | null>(null);
  const voiceValueRef = useRef('');
  voiceValueRef.current = value;
  // live count for capacity checks inside event handlers (no stale closures)
  const imgsLenRef = useRef(0);
  imgsLenRef.current = imgs.length;

  // ---------- attachments (paste / picker / drop — one shared path) ----------
  const attachFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || files.length === 0) return;
      const mentions: string[] = [];
      const pending: Promise<string | null>[] = [];
      let tooBig = false;

      for (const f of Array.from(files)) {
        const path = (f as File & { path?: string }).path;
        if (f.type.startsWith('image/')) {
          if (f.size > MAX_IMAGE_BYTES) {
            tooBig = true;
            continue;
          }
          pending.push(fileToDataUrl(f));
        } else {
          // text/other file → mention by path (Electron exposes the absolute
          // path on File; fall back to the file name)
          mentions.push(`@${path || f.name}`);
        }
      }

      const urls = (await Promise.all(pending)).filter((u): u is string => !!u);
      const room = Math.max(0, MAX_IMAGES - imgsLenRef.current);
      const accepted = urls.slice(0, room);
      if (accepted.length > 0) setImgs((cur) => [...cur, ...accepted].slice(0, MAX_IMAGES));

      if (mentions.length > 0) {
        const joined = mentions.join(' ');
        setValue((cur) => (cur.trim() ? `${cur.replace(/\s+$/, '')} ${joined} ` : `${joined} `));
        setSuppressed(null);
        setActiveIdx(0);
      }
      if (tooBig) notify(t('chat.imageTooBig', 'Image too large (max 5 MB)'));
      if (urls.length > accepted.length) notify(t('chat.imagesFull', 'Up to 5 images per message'));
    },
    [notify, t],
  );

  // Expose the shared attach path for panel-level drops.
  useEffect(() => {
    composerBridge.attachFiles = (files) => void attachFiles(files);
    return () => {
      composerBridge.attachFiles = null;
    };
  }, [attachFiles]);

  const removeImage = (i: number) => setImgs((cur) => cur.filter((_, j) => j !== i));

  const update = (v: string) => {
    setValue(v);
    setSuppressed(null);
    setActiveIdx(0);
  };

  // auto-grow textarea
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TA_HEIGHT)}px`;
  }, [value, running]);

  // External inserts (editor actions like "send selection to chat"):
  // append to the input, then focus with the caret at the end.
  useEffect(() => {
    if (!composerInsert || composerInsert.seq === lastInsertSeq.current) return;
    lastInsertSeq.current = composerInsert.seq;
    const text = composerInsert.text;
    if (!text) return;
    setValue((cur) => (cur ? `${cur}\n${text}` : text));
    setSuppressed(null);
    setActiveIdx(0);
    const id = requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
    return () => cancelAnimationFrame(id);
  }, [composerInsert]);

  // ----- slash commands (v10.3 — grouped Codex-style registry) -----
  // v11.9 — custom slash commands: fetched on mount + whenever the workspace
  // changes; the textarea onFocus below re-runs it (the 30s module cache makes
  // that a no-op unless commands were added/edited on disk since).
  const [customCmds, setCustomCmds] = useState<SlashCommandInfo[]>([]);
  const refreshCustomCmds = useCallback(
    (force?: boolean) => {
      void loadCustomSlashCommands(wsPath ?? '', force === true).then((list) => setCustomCmds(list));
    },
    [wsPath],
  );
  useEffect(() => {
    refreshCustomCmds();
  }, [refreshCustomCmds]);

  const nextMode = nextIn(PERMISSION_MODES, mode);
  // TASK A — one geometry for all four chips, independent of the active one.
  const modeChipMinWidth = modeChipMinWidthPx();
  // v11.26 — the advertised menu. Labels come from slashDescription()/arg hints;
  // the command→effect CONTRACT lives in the canonical SLASH_COMMANDS registry
  // (src/lib/modes.ts) that the all-slash proof test iterates. This literal list
  // stays explicit so source-level wiring guards can see each `cmd` token.
  // /build + /debug join /plan so all four engine task modes are slash-reachable.
  const D = (c: string) => slashDescription(c, t, lang === 'ar', nextMode);
  const A = (c: string) => slashArgHint(c, t, lang === 'ar');
  const commands: SlashCmd[] = [
    // session
    { cmd: '/clear', desc: D('/clear'), action: 'send', group: 'session' },
    { cmd: '/compact', desc: D('/compact'), action: 'send', group: 'session' },
    { cmd: '/rewind', desc: D('/rewind'), action: 'fill', group: 'session' },
    // v11.12 — restore the NEWEST checkpoint in one step (the chooser above is
    // still available via /rewind and the history button).
    { cmd: '/undo', desc: D('/undo'), action: 'send', group: 'session' },
    { cmd: '/continue', desc: D('/continue'), action: 'send', group: 'session' },
    { cmd: '/fork', desc: D('/fork'), action: 'send', group: 'session' },
    { cmd: '/export', desc: D('/export'), action: 'send', group: 'session' },
    { cmd: '/goal', desc: D('/goal'), action: 'fill', group: 'session', arg: A('/goal') },
    { cmd: '/schedule', desc: D('/schedule'), action: 'schedule', group: 'session' },
    // v11.9 — /handoff + /grill live in the store's template registry
    // (store.ts SLASH_PROMPT_TEMPLATES) but were missing from this menu.
    { cmd: '/handoff', desc: D('/handoff'), action: 'send', group: 'session' },
    // context
    { cmd: '/init', desc: D('/init'), action: 'fill', group: 'context' },
    { cmd: '/context', desc: D('/context'), action: 'fill', group: 'context' },
    { cmd: '/cost', desc: D('/cost'), action: 'fill', group: 'context' },
    { cmd: '/dna', desc: D('/dna'), action: 'fill', group: 'context' },
    // build & review — all four task modes are slash-reachable
    { cmd: '/build', desc: D('/build'), action: 'taskmode', group: 'build', taskMode: 'build' },
    { cmd: '/plan', desc: D('/plan'), action: 'taskmode', group: 'build', taskMode: 'plan' },
    { cmd: '/debug', desc: D('/debug'), action: 'taskmode', group: 'build', taskMode: 'debug' },
    { cmd: '/review', desc: D('/review'), action: 'send', group: 'build' },
    { cmd: '/tests', desc: D('/tests'), action: 'fill', group: 'build', arg: A('/tests') },
    // v11.13 — real, verifiable build/review capabilities (git diff, real
    // test run with exit code, one-shot model explanation).
    { cmd: '/diff', desc: D('/diff'), action: 'fill', group: 'build', arg: A('/diff') },
    { cmd: '/test', desc: D('/test'), action: 'fill', group: 'build', arg: A('/test') },
    { cmd: '/explain', desc: D('/explain'), action: 'fill', group: 'build', arg: A('/explain') },
    { cmd: '/commit', desc: D('/commit'), action: 'send', group: 'build' },
    { cmd: '/pr', desc: D('/pr'), action: 'send', group: 'build' },
    // v11.9 — grill-first planning (store template): fill so a topic can ride along
    { cmd: '/grill', desc: D('/grill'), action: 'fill', group: 'build', arg: A('/grill') },
    { cmd: '/changelog', desc: D('/changelog'), action: 'send', group: 'build' },
    { cmd: '/flows', desc: D('/flows'), action: 'send', group: 'build' },
    // agent
    { cmd: '/effort', desc: D('/effort'), action: 'fill', group: 'agent' },
    { cmd: '/model', desc: D('/model'), action: 'fill', group: 'agent', arg: A('/model') },
    { cmd: '/profile', desc: D('/profile'), action: 'fill', group: 'agent', arg: A('/profile') },
    { cmd: '/mode', desc: D('/mode'), action: 'mode', group: 'agent' },
    { cmd: '/budget', desc: D('/budget'), action: 'send', group: 'agent' },
    // app
    { cmd: '/settings', desc: D('/settings'), action: 'settings', group: 'app' },
    { cmd: '/theme', desc: D('/theme'), action: 'theme', group: 'app' },
    { cmd: '/lang', desc: D('/lang'), action: 'lang', group: 'app' },
    { cmd: '/plans', desc: D('/plans'), action: 'plans', group: 'app' },
    { cmd: '/terminal', desc: D('/terminal'), action: 'fill', group: 'app' },
    { cmd: '/help', desc: D('/help'), action: 'send', group: 'app' },
    // panels
    { cmd: '/git', desc: D('/git'), action: 'panel', panel: 'git', group: 'panels' },
    // v11.13 — these now run REAL commands (list/test MCP, toggle/list skills)
    // instead of only opening a rail panel; the panels remain reachable from
    // the sidebar and from Settings.
    { cmd: '/mcp', desc: D('/mcp'), action: 'fill', group: 'panels', arg: A('/mcp') },
    { cmd: '/skills', desc: D('/skills'), action: 'fill', group: 'panels', arg: A('/skills') },
    { cmd: '/usage', desc: D('/usage'), action: 'panel', panel: 'usage', group: 'panels' },
    { cmd: '/library', desc: D('/library'), action: 'panel', panel: 'library', group: 'panels' },
    // v11.6 — prompt library
    { cmd: '/prompts', desc: D('/prompts'), action: 'panel', panel: 'prompts', group: 'panels' },
  ];

  // v11.9 — custom user/workspace markdown commands (kdx:agent:slashCommands)
  // as a NEW menu group. Fetched on mount + textarea focus (30s module cache);
  // picking one fills the composer with "/name" — the engine expands the
  // markdown body (with $ARGUMENTS) when the message is sent.
  const customCommands: SlashCmd[] = customCmds
    .filter((c) => !!c && typeof c.name === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(c.name))
    .map((c) => ({
      cmd: `/${c.name}`,
      desc:
        (c.description ?? '').trim() ||
        t(
          'slash.custom.noDesc',
          c.source === 'workspace'
            ? lang === 'ar'
              ? 'أمر مساحة العمل'
              : 'Workspace command'
            : lang === 'ar'
              ? 'أمر مستخدم'
              : 'User command',
        ),
      action: 'fill',
      group: 'custom',
      arg:
        c.source === 'workspace'
          ? lang === 'ar'
            ? 'مساحة العمل'
            : 'workspace'
          : lang === 'ar'
            ? 'مستخدم'
            : 'user',
    }));
  const allCommands: SlashCmd[] = [...commands, ...customCommands];

  // v11.26 — single shared parser contract with lib/modes (leading '/',
  // ASCII slug, no whitespace while live-filtering).
  const isSlash = isSlashMenuQuery(value);
  const slashItems = isSlash
    ? allCommands.filter((c) => c.cmd.toLowerCase().startsWith(value.toLowerCase()))
    : [];

  // ----- file mentions (@path) — capped flattened tree, now owned by "+" -----
  // v11.43 — the floating '@' suggestion list was visual clutter in the middle
  // of the chat panel. The SAME capped list is handed to AttachMenu, which
  // renders it as a hairline submenu inside the existing "+" popover. No new
  // IPC and no second file source: picking a row calls `insertMention` below,
  // the very same @path insertion the old list used. Typing '@' still writes a
  // literal token for power users — it simply no longer pops a list over chat.
  const mentionPaths = useMemo<MentionItem[]>(() => {
    if (!fileTree || !wsPath) return [];
    const out: MentionItem[] = [];
    flattenTree(fileTree, wsPath, out);
    return out;
  }, [fileTree, wsPath]);

  const menu: 'slash' | null = slashItems.length > 0 && suppressed !== 'slash' ? 'slash' : null;
  const items = menu === 'slash' ? slashItems : [];
  const sel = Math.min(activeIdx, Math.max(0, items.length - 1));

  useEffect(() => {
    menuRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel, menu]);

  /** Send now (idle) or hand to sendMessage which queues while running. */
  const send = () => {
    const v = value.trim();
    if (!v && imgs.length === 0) return;
    void sendMessage(v || (imgs.length ? t('chat.imagesOnly', '[image attached]') : ''), imgs);
    update('');
    setImgs([]);
  };

  /** STEER — inject mid-run guidance at the next tool boundary. */
  const steer = () => {
    const v = value.trim();
    if (!v || !running) return;
    void sendSteer(v);
    update('');
  };

  const selectSlash = (c: SlashCmd) => {
    switch (c.action) {
      case 'send':
        void sendMessage(c.cmd);
        update('');
        break;
      case 'fill':
        // fill the input; suppress the menu so Enter sends the command itself.
        // Argument-taking commands get a trailing space ready for the value.
        setValue(c.arg ? `${c.cmd} ` : c.cmd);
        setSuppressed('slash');
        setActiveIdx(0);
        break;
      case 'model':
        setModelPicker(true);
        update('');
        break;
      case 'plans':
        setPlans(true);
        update('');
        break;
      case 'schedule':
        setScheduled(true);
        update('');
        break;
      case 'theme':
        cycleTheme();
        update('');
        break;
      case 'lang':
        setLang(lang === 'ar' ? 'en' : 'ar');
        update('');
        break;
      case 'mode':
        setMode(nextMode);
        update('');
        break;
      case 'settings':
        setSettingsModal(true, c.section);
        update('');
        break;
      case 'panel':
        if (c.panel) setRail(c.panel);
        update('');
        break;
      case 'taskmode':
        // v11.26 — /build /plan /debug switch the REAL engine task mode (the
        // same posture the BUILD/PLAN/DEBUG/REVIEW stamp strip drives). The
        // store posts the bilingual visible notice; the next run uses the new
        // protocol (read-only PLAN, test-loop DEBUG, proofs BUILD).
        if (c.taskMode) setTaskMode(c.taskMode);
        update('');
        break;
    }
    taRef.current?.focus();
  };

  /**
   * Insert a REAL @path token into the composer — the single mention action.
   * The "+" → "Mention file" submenu calls it with a chosen relative path. If
   * the user was mid-`@query` the partial query is replaced; otherwise a fresh
   * mention is appended after a separating space. No auto-send: the user
   * reviews the text exactly as with a slash insertion.
   */
  const insertMention = (rel: string) => {
    const m = /(?:^|\s)@([^\s]*)$/.exec(value);
    const head = m
      ? value.slice(0, m.index) + (m[0].startsWith(' ') ? ' ' : '')
      : value.trim()
        ? `${value.replace(/\s+$/, '')} `
        : '';
    update(`${head}@${rel} `);
    taRef.current?.focus();
  };

  const pickActive = () => {
    if (menu === 'slash') {
      const c = slashItems[sel];
      if (c) selectSlash(c);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu !== null && items.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % items.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + items.length) % items.length);
        return;
      }
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        e.preventDefault();
        pickActive();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSuppressed(menu); // closed until the value changes again
        return;
      }
    }
    // v7.2 — ↑ on an EMPTY composer quotes/edits the last user message
    // (walks past synthetic steer/queued rows; leaves the caret at the end).
    if (e.key === 'ArrowUp' && value.length === 0 && imgs.length === 0 && !running) {
      const msgs = useStore.getState().session?.messages ?? [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.role === 'user') {
          if (m.model === 'steer' || m.model === 'queued') continue;
          e.preventDefault();
          setValue(m.content);
          setSuppressed(null);
          setActiveIdx(0);
          requestAnimationFrame(() => {
            const el = taRef.current;
            if (!el) return;
            const end = el.value.length;
            el.setSelectionRange(end, end);
          });
          return;
        }
        break; // only look at the tail block
      }
      return;
    }
    // v7.2 — Esc stops a running task (existing abort path) when the
    // composer has no menus open and nothing typed to dismiss.
    if (e.key === 'Escape' && running && value.length === 0) {
      e.preventDefault();
      void abortAgent();
      return;
    }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      if (running && e.shiftKey) {
        // running: Shift+Enter = STEER (mid-run injection, amber chip)
        e.preventDefault();
        steer();
        return;
      }
      if (!e.shiftKey) {
        // idle: send · running: queue (store reroutes)
        e.preventDefault();
        send();
        return;
      }
      // idle shift+enter → newline (default textarea behavior)
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files || []).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      void attachFiles(files);
    }
  };

  // ---------- drag & drop ----------
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  const onDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation(); // the ChatPanel drop handler must not double-attach
    dragDepth.current = 0;
    setDragOver(false);
    void attachFiles(e.dataTransfer.files);
  };

  // reset the drag state if the composer unmounts mid-drag
  useEffect(
    () => () => {
      dragDepth.current = 0;
    },
    [],
  );

  // ---------- v12 — prompt presets quick insert ----------
  const loadPresets = useCallback(async () => {
    try {
      const list = await api.promptsList();
      setPresets(Array.isArray(list) ? (list as PromptPresetLike[]) : []);
    } catch {
      setPresets([]); // bridge missing / main busy — the popover shows an empty state
    } finally {
      setPresetsLoaded(true);
    }
  }, []);

  const togglePresets = () => {
    const opening = !presetsOpen;
    setPresetsOpen(opening);
    setPresetQuery('');
    if (opening && !presetsLoaded) void loadPresets();
  };

  const shownPresets = useMemo(() => filterPromptPresets(presets, presetQuery), [presets, presetQuery]);

  // v11.13 — real copy-to-clipboard for the capability output panel. Falls back
  // to execCommand in non-secure contexts (file:// dev builds).
  const copyCapability = useCallback(async () => {
    const text = capabilityPanel?.text ?? '';
    if (!text) return;
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
      notify(t('cap.panel.copied', 'Output copied'));
    } catch {
      notify(t('misc.error', 'Error'));
    }
  }, [capabilityPanel, notify, t]);

  const insertPreset = (p: PromptPresetLike) => {
    insertIntoComposer(p.text);
    setPresetsOpen(false);
    setPresetQuery('');
    notify(t('presets.inserted', lang === 'ar' ? 'أُدرج في المحادثة' : 'Preset inserted into the composer'));
    requestAnimationFrame(() => taRef.current?.focus());
  };

  // dismiss the popover on outside click / Esc (stops before app-level handlers)
  useEffect(() => {
    if (!presetsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!presetsRef.current?.contains(e.target as Node)) setPresetsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setPresetsOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [presetsOpen]);

  // ---------- voice input (mic → whisper via the active provider) ----------

  /** Release mic + timer; safe to call from every teardown path. */
  const releaseVoice = useCallback(() => {
    if (voiceTimerRef.current !== null) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    // Waveform ring teardown: stop sampling, drop the analyser, close the
    // analysis-only context (WebM path) and reset the reported level to zero.
    if (voiceLevelRafRef.current !== null) {
      window.cancelAnimationFrame(voiceLevelRafRef.current);
      voiceLevelRafRef.current = null;
    }
    voiceAnalyserRef.current = null;
    voiceLevelBufRef.current = null;
    try {
      void voiceAnalysisCtxRef.current?.close();
    } catch {
      /* context already closed */
    }
    voiceAnalysisCtxRef.current = null;
    setVoiceLevel(0);
    setVoiceLevelAvailable(false);
    if (voiceResultTimerRef.current !== null) {
      window.clearTimeout(voiceResultTimerRef.current);
      voiceResultTimerRef.current = null;
    }
    try {
      voiceStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    } catch {
      /* stream already gone */
    }
    voiceStreamRef.current = null;
    voiceRecRef.current = null;
    // v11.4 — PCM capture graph teardown (all no-ops on the MediaRecorder path)
    try {
      voiceProcRef.current?.disconnect();
      voiceSrcRef.current?.disconnect();
    } catch {
      /* nodes already disconnected */
    }
    voiceProcRef.current = null;
    voiceSrcRef.current = null;
    voicePcmRef.current = null;
    try {
      void voiceCtxRef.current?.close();
    } catch {
      /* context already closed */
    }
    voiceCtxRef.current = null;
  }, []);

  /** Unmount mid-recording: drop the mic silently (no transcription). */
  useEffect(
    () => () => {
      const rec = voiceRecRef.current;
      if (rec && rec.state === 'recording') {
        rec.onstop = null;
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }
      releaseVoice();
    },
    [releaseVoice],
  );

  /** Splice text at the caret (keeps the surrounding input intact). Returns
   *  the resulting composer value (autoSend rides it). */
  const insertAtCursor = useCallback(
    (text: string): string => {
      const el = taRef.current;
      const cur = voiceValueRef.current;
      const start = el?.selectionStart ?? cur.length;
      const end = el?.selectionEnd ?? cur.length;
      const next = cur.slice(0, start) + text + cur.slice(end);
      update(next);
      requestAnimationFrame(() => {
        const node = taRef.current;
        if (!node) return;
        const pos = start + text.length;
        node.focus();
        node.setSelectionRange(pos, pos);
      });
      return next;
    },
    // update is a stable-enough local closure (setState wrappers)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );


  /** v10.2 — precise voice-failure messages (the old toast blamed the wrong thing). */
  const voiceFail = useCallback(
    (code?: string) => {
      const ar = lang === 'ar';
      const known: Record<string, string> = {
        EMPTY_AUDIO: ar ? 'التسجيل فارغ — حاول مرة أخرى.' : 'Recording was empty — try again.',
        NO_PROVIDER: ar
          ? 'لا يوجد مزوّد نشط. اختر نموذجًا من الإعدادات أو مزوّد صوت من الإعدادات ← الصوت.'
          : 'No active provider. Pick a model in Settings, or a voice provider in Settings → Voice.',
        NO_API_KEY: ar
          ? 'أضف مفتاح API لمزوّد التفريغ النصي (الإعدادات ← المزوّدون أو الإعدادات ← الصوت).'
          : 'Add an API key for the transcription provider (Settings → Providers or Settings → Voice).',
        NO_TRANSCRIPTION_ENDPOINT: ar
          ? 'المزوّد النشط لا يدعم تحويل الصوت إلى نص. الصوت مدعوم اليوم مع المزوّدات المتوافقة مع OpenAI (OpenAI وGroq وOpenRouter وMoonshot وMistral وQwen) ومع Z.AI/GLM — اختر واحداً من الإعدادات ← الصوت.'
          : 'The active provider has no speech-to-text route. Voice works today with OpenAI-compatible providers (OpenAI, Groq, OpenRouter, Moonshot, Mistral, Qwen) and Z.AI/GLM — pick one in Settings → Voice.',
        VOICE_DISABLED: ar ? 'الإدخال الصوتي معطّل من الإعدادات ← الصوت.' : 'Voice input is disabled in Settings → Voice.',
        VOICE_FORMAT: ar
          ? 'مزوّد التفريغ المختار (GLM-ASR) يقبل صيغ WAV أو MP3 فقط — أعد التسجيل بزر الميكروفون (يسجّل WAV الآن) أو بدّل مزوّد الصوت.'
          : 'The chosen voice provider (GLM-ASR) only accepts WAV or MP3 — re-record with the mic button (it records WAV now) or switch the voice provider.',
        EMPTY_TRANSCRIPT: ar ? 'لم يُكتشف كلام في التسجيل.' : 'No speech detected in the recording.',
        TIMEOUT: ar ? 'انتهت مهلة التفريغ النصي — قد يكون التسجيل طويلًا.' : 'Transcription timed out — the audio may be too long.',
        NO_FETCH_RUNTIME: ar ? 'محرك التفريغ غير متاح في هذا البناء.' : 'Transcription runtime unavailable in this build.',
      };
      const c = String(code ?? '');
      notify(known[c] ?? (c ? `${ar ? 'فشل الصوت' : 'Voice input failed'} (${c})` : ar ? 'فشل الإدخال الصوتي.' : 'Voice input failed.'));
    },
    [lang, notify],
  );

  /** Recording stopped → blob → base64 → main-side transcription. v11.4 —
   *  the PCM path hands a pre-encoded 16 kHz WAV blob; autoSend mirrors send().
   *  On success the transcript is previewed in the `result` posture (the API
   *  returns the FINAL text only — no interim transcript is fabricated). */
  const finishVoice = useCallback(
    async (mime: string, prepared?: Blob) => {
      releaseVoice();
      const blob = prepared ?? new Blob(voiceChunksRef.current, { type: mime || 'audio/webm' });
      voiceChunksRef.current = [];
      if (blob.size === 0) {
        setVoice('idle');
        voiceFail('EMPTY_AUDIO');
        return;
      }
      setVoice('busy');
      let preview = '';
      try {
        const b64 = await blobToBase64(blob);
        if (!b64) {
          voiceFail('EMPTY_AUDIO');
          return;
        }
        const res = await api
          .transcribeAudio(b64, mime || 'audio/webm')
          .catch((err: unknown): TranscribeResult => ({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }));
        const text = res.ok && typeof res.text === 'string' ? res.text.trim() : '';
        if (res.ok && text) {
          preview = text;
          const next = insertAtCursor(text);
          if (voiceAutoSend) {
            // autoSend — mirror send(): the whole composer content rides.
            const v = next.trim();
            if (v || imgs.length > 0) {
              void sendMessage(v || t('chat.imagesOnly', '[image attached]'), imgs);
              update('');
              setImgs([]);
            }
            notify(t('chat.voice.sent', 'Transcript sent'));
          } else {
            notify(t('chat.voice.done', 'Transcript inserted'));
          }
        } else {
          voiceFail(res.ok ? 'EMPTY_TRANSCRIPT' : res.error);
        }
      } catch (err) {
        voiceFail(err instanceof Error ? err.message : String(err));
      } finally {
        if (preview) {
          setVoiceResultText(preview);
          setVoice('result');
          // brief, tasteful confirmation — then back to idle.
          if (voiceResultTimerRef.current !== null) window.clearTimeout(voiceResultTimerRef.current);
          voiceResultTimerRef.current = window.setTimeout(() => {
            voiceResultTimerRef.current = null;
            setVoice('idle');
            setVoiceResultText('');
          }, 2600);
        } else {
          setVoice('idle');
        }
      }
    },
    // update/setImgs are stable setState wrappers
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imgs, insertAtCursor, notify, releaseVoice, sendMessage, t, voiceAutoSend, voiceFail],
  );

  const startVoice = useCallback(async () => {
    if (voice === 'busy' || voice === 'recording') return;
    // a new take dismisses any lingering success preview
    if (voiceResultTimerRef.current !== null) {
      window.clearTimeout(voiceResultTimerRef.current);
      voiceResultTimerRef.current = null;
    }
    setVoiceResultText('');
    // never break the composer when the platform lacks media capture
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      notify(
        t(
          'chat.voice.unsupported',
          lang === 'ar'
            ? 'التقاط الصوت غير مدعوم في هذه النافذة. حدّث الإصدار أو تحقق من إعدادات الإذن.'
            : 'Audio capture is unavailable in this window. Update SADEEM or check permission settings.',
        ),
      );
      return;
    }
    // v11.4 — the pinned ASR provider wins over the active provider; every
    // family NOT known to accept WebM/Opus records 16 kHz mono PCM WAV
    // (GLM-ASR is WAV/MP3-only; WAV is accepted by all OpenAI-compatible routes).
    const pinned = String(voicePrefs?.asrProvider ?? 'auto').trim();
    const family = pinned && pinned !== 'auto' && pinned !== 'off' ? pinned : String(model.provider ?? '');
    const useWebm = WEBM_ASR_FAMILIES.has(family) && typeof MediaRecorder !== 'undefined';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: voiceDeviceId ? { deviceId: { exact: voiceDeviceId } } : true,
      });
      voiceStreamRef.current = stream;
      setVoiceSecs(0);
      setVoice('recording');
      voiceTimerRef.current = window.setInterval(() => setVoiceSecs((s) => s + 1), 1000);
      if (useWebm) {
        const rec = new MediaRecorder(stream);
        voiceChunksRef.current = [];
        rec.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) voiceChunksRef.current.push(e.data);
        };
        rec.onstop = () => void finishVoice(rec.mimeType || 'audio/webm');
        rec.start();
        voiceRecRef.current = rec;
      } else {
        // PCM path: 16 kHz context when the device honors the hint, else the
        // native rate + manual downsampling before the WAV encode.
        const ctx = new AudioContext({ sampleRate: PCM_TARGET_RATE });
        voiceCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        voicePcmRef.current = [];
        proc.onaudioprocess = (e: AudioProcessingEvent) => {
          // the input buffer is reused by the audio thread — copy it
          voicePcmRef.current?.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };
        src.connect(proc);
        // zero-gain sink keeps the capture graph live without audible feedback
        const mute = ctx.createGain();
        mute.gain.value = 0;
        proc.connect(mute);
        mute.connect(ctx.destination);
        voiceSrcRef.current = src;
        voiceProcRef.current = proc;
      }

      // ---- REAL amplitude tap for the waveform ring + orb ----------------
      // This is a genuine Web Audio AnalyserNode, never a timer-driven fake.
      // PCM reuses the capture context/source above; WebM (which has no
      // AudioContext) gets a small silent analysis-only graph. getByteTime-
      // DomainData → RMS → 0..1 level, sampled on rAF and throttled to ~20fps
      // so the rest of the composer is not re-rendered at 60fps.
      try {
        let analyser: AnalyserNode;
        if (voiceCtxRef.current && voiceSrcRef.current) {
          const ctx = voiceCtxRef.current;
          analyser = ctx.createAnalyser();
          voiceSrcRef.current.connect(analyser);
          const sink = ctx.createGain();
          sink.gain.value = 0; // inaudible: the analyser just needs a pull
          analyser.connect(sink);
          sink.connect(ctx.destination);
        } else {
          const actx = new AudioContext();
          const aSrc = actx.createMediaStreamSource(stream);
          analyser = actx.createAnalyser();
          const sink = actx.createGain();
          sink.gain.value = 0;
          aSrc.connect(analyser);
          analyser.connect(sink);
          sink.connect(actx.destination);
          voiceAnalysisCtxRef.current = actx;
        }
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.7;
        voiceAnalyserRef.current = analyser;
        voiceLevelBufRef.current = new Uint8Array(analyser.fftSize);
        let frames = 0;
        const tick = () => {
          const an = voiceAnalyserRef.current;
          const buf = voiceLevelBufRef.current;
          if (!an || !buf) return; // torn down mid-frame
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          if (++frames % 3 === 1) {
            setVoiceLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3.6));
          }
          voiceLevelRafRef.current = window.requestAnimationFrame(tick);
        };
        voiceLevelRafRef.current = window.requestAnimationFrame(tick);
        setVoiceLevelAvailable(true);
      } catch {
        // No analyser available: the UI falls back to an explicitly-labelled
        // steady pulse (never invented/random "voice" activity).
        voiceAnalyserRef.current = null;
        setVoiceLevelAvailable(false);
      }
    } catch (err) {
      releaseVoice();
      setVoice('idle');
      // v11.4 — honest per-cause mic errors (denied vs missing vs other)
      const name = err instanceof DOMException ? err.name : '';
      const ar = lang === 'ar';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        notify(
          ar
            ? 'رُفض الوصول إلى الميكروفون. اسمح لـ SADEEM من إعدادات النظام (ويندوز: الإعدادات ← الخصوصية ← الميكروفون؛ ماك: إعدادات النظام ← الخصوصية والأمان ← الميكروفون) ثم أعد المحاولة.'
            : 'Microphone access was denied. Allow SADEEM in your OS settings (Windows: Settings → Privacy → Microphone; macOS: System Settings → Privacy & Security → Microphone), then retry.',
        );
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        notify(t('chat.voice.noDevice', ar ? 'لم يُعثر على ميكروفون.' : 'No microphone was found.'));
      } else {
        notify(
          ar
            ? `تعذّر بدء الميكروفون${name ? ` (${name})` : ''}.`
            : `Microphone could not start${name ? ` (${name})` : ''}.`,
        );
      }
    }
  }, [finishVoice, lang, model.provider, notify, releaseVoice, t, voice, voiceDeviceId, voicePrefs]);

  const stopVoice = useCallback(() => {
    // v11.4 — PCM path: freeze capture, encode 16 kHz mono WAV, transcribe.
    const proc = voiceProcRef.current;
    if (proc) {
      proc.onaudioprocess = null;
      const chunks = voicePcmRef.current ?? [];
      const rate = voiceCtxRef.current?.sampleRate ?? PCM_TARGET_RATE;
      voicePcmRef.current = null;
      voiceSrcRef.current = null;
      voiceProcRef.current = null;
      releaseVoice(); // stops the mic + closes the AudioContext
      void finishVoice('audio/wav', chunks.length > 0 ? float32ToWavBlob(chunks, rate) : new Blob());
      return;
    }
    const rec = voiceRecRef.current;
    if (!rec || rec.state === 'inactive') {
      releaseVoice();
      setVoice('idle');
      return;
    }
    try {
      rec.stop(); // onstop → finishVoice
    } catch {
      releaseVoice();
      setVoice('idle');
    }
  }, [finishVoice, releaseVoice]);

  // v11.31 — live streamed chars are still read, but ONLY to detect the first
  // real engine event for the immediate send-feedback latch below. The dead
  // fill/pct/tone math that used to render a straight context strip is gone —
  // ContextLens owns that single indicator now.
  const liveStreamChars = useStore((s) => s.liveStreamChars);
  // FINAL POLISH — real, transcript-derived run progress (null while idle).
  const runSteps = useRunProgressSteps();

  // v11.19 — "pressing send leaves a blank screen" fix. `running` flips true
  // BEFORE the engine emits any event, and ChatPanel's live strip waits for the
  // first real event — the perception gap still felt dead. Latch a LOCAL sending
  // phase the instant a run exists and show a pill + sweeping hairline without
  // waiting for the engine. Clear it (short fade) on the FIRST real engine
  // event (first streamed chars or the first new assistant/tool row), where
  // ChatPanel's live panel takes over. State is local — never engine-driven.
  const msgs = useStore((s) => s.session?.messages ?? NO_RUN_MESSAGES);
  // v11.31 — the OS kill-switch already stops the inline transition, but the
  // in-app `html.reduce-motion` switch has no global rule for Tailwind's
  // `animate-pulse`. Check both (same pattern as the chat run strip) so this
  // transient feedback is fully calm when the founder turns motion off.
  const sendingReduced =
    typeof document !== 'undefined' &&
    (document.documentElement.classList.contains('reduce-motion') ||
      (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches));
  const [sendPhase, setSendPhase] = useState<'on' | 'out' | 'off'>(running ? 'on' : 'off');
  const sendFadeRef = useRef<number | null>(null);
  const prevRunningRef = useRef(running);
  const sentAtRef = useRef(running ? Date.now() : 0);
  // render-edge transition (same pattern as useRunProgressSteps): stamp the
  // send time BEFORE "first event" is derived so old rows never count.
  if (running !== prevRunningRef.current) {
    prevRunningRef.current = running;
    if (running) sentAtRef.current = Date.now();
  }
  const firstEngineEvent =
    liveStreamChars > 0 ||
    msgs.some(
      (m) =>
        m.timestamp >= sentAtRef.current &&
        (m.role === 'assistant' || m.kind === 'tool_call' || m.kind === 'tool_result'),
    );

  useEffect(() => {
    if (running && sendPhase !== 'on') {
      if (sendFadeRef.current !== null) {
        window.clearTimeout(sendFadeRef.current);
        sendFadeRef.current = null;
      }
      setSendPhase('on');
    } else if (firstEngineEvent && sendPhase === 'on') {
      setSendPhase('out');
      sendFadeRef.current = window.setTimeout(() => {
        setSendPhase('off');
        sendFadeRef.current = null;
      }, 220);
    } else if (!running && !firstEngineEvent && sendPhase !== 'off') {
      // rejected / no-op run (no folder, no key, already running): drop it
      setSendPhase('off');
    }
  }, [running, firstEngineEvent, sendPhase]);

  useEffect(
    () => () => {
      if (sendFadeRef.current !== null) window.clearTimeout(sendFadeRef.current);
    },
    [],
  );

  return (
    <div className="composer-dock composer-dock-v13">
      {/* dismissible queued-message chips (engine drains FIFO; queued_count syncs) */}
      {queuedItems.length > 0 && (
        <div className="sc-qchips" role="list" aria-label={t('chat.queuedHint', 'Queued messages')}>
          {queuedItems.map((q, i) => (
            <span key={`${i}:${q.slice(0, 12)}`} className="sc-qchip" role="listitem" title={q}>
              <span dir="auto">{truncChip(q)}</span>
              <button
                onClick={() => dismissQueued(i)}
                aria-label={t('chat.dismissQueued', 'Dismiss queued message')}
                title={t('chat.dismissQueued', 'Dismiss queued message')}
              >
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* v6 — pending artifact comments chip (Antigravity parity): they ride
          along with the next message; inspect on hover, clear with the ×. */}
      {artifactComments.length > 0 && (
        <div className="flex justify-center mb-1.5">
          <span
            className="stamp stamp-acc !h-[18px] !px-2 !text-[11px] cursor-default"
            title={artifactComments.map((c, i) => `${i + 1}. ${c}`).join('\n')}
          >
            <MessageSquare size={9} className="shrink-0" />
            {t('chat.pendingComments', '{n} comments · sent with your next message')
              .replace('{n}', String(artifactComments.length))}
            <button
              onClick={clearArtifactComments}
              aria-label={t('chat.clearComments', 'Clear comments')}
              title={t('chat.clearComments', 'Clear comments')}
              className="ms-1 hover:opacity-70 cursor-pointer"
            >
              <X size={8} />
            </button>
          </span>
        </div>
      )}

      {/* premium flat card — focus = one teal hairline (chat.css §9) */}
      <div
        className="relative sc-deck composer-card composer-card-v13 p-2.5"
        data-drag={dragOver ? 'true' : undefined}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {menu === 'slash' && (
          <div
            ref={menuRef}
            className="glass-menu absolute bottom-full mb-2 inset-x-0 max-h-64 overflow-auto p-1 z-10 anim-in rounded-[10px]"
            role="listbox"
            aria-label={t('slash.menu', 'Slash commands')}
          >
            {SLASH_GROUPS.map((g) => {
              const rows = slashItems.filter((c) => c.group === g.id);
              if (rows.length === 0) return null;
              return (
                <div key={g.id} role="group" aria-label={lang === 'ar' ? g.ar : g.en}>
                  <div className="px-2 pt-1.5 pb-1 caps text-[8.5px] text-faint font-semibold tracking-wide" dir="auto">
                    {lang === 'ar' ? g.ar : g.en}
                  </div>
                  {rows.map((c) => {
                    const i = slashItems.indexOf(c);
                    return (
                      <div
                        key={`${c.group}:${c.cmd}`}
                        data-active={i === sel}
                        className={`h-8 px-2 flex items-center gap-2 rounded-[8px] cursor-pointer row-hover ${i === sel ? 'bg-panel2' : ''}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectSlash(c);
                        }}
                        onMouseEnter={() => setActiveIdx(i)}
                      >
                        <span className="font-code text-[11.5px] text-acc shrink-0 w-[86px]" dir="ltr">{c.cmd}</span>
                        <span className="text-[12px] text-dim truncate flex-1 min-w-0" dir="auto">{c.desc}</span>
                        {c.arg && (
                          <span className="stamp !h-[15px] !px-1.5 !text-[8.5px] text-faint shrink-0" dir="ltr">{c.arg}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* v11.43 — the floating '@' mention list was removed from here. The
            same capped file list now lives inside the "+" popover (AttachMenu)
            as the "Mention file / استشهاد بملف" submenu — no list over chat. */}

        {/* drop highlight overlay */}
        {dragOver && (
          <div className="absolute inset-1 z-20 rounded-[10px] border border-dashed border-acc bg-[color-mix(in_srgb,var(--acc)_10%,transparent)] flex items-center justify-center pointer-events-none anim-in">
            <span className="text-[11.5px] font-medium text-acc" dir="auto">{t('chat.drop', 'Drop files to attach')}</span>
          </div>
        )}

        {/* v11.13 — captured output of the last REAL slash capability (/diff,
            /test, /explain, /skills, /mcp, /budget). This is the actual command
            output (patch, test stdout/stderr, explanation, server list, usage)
            with a working copy-to-clipboard button — not a decorative card. */}
        {capabilityPanel && (
          <div
            className="sc-cap-panel glass-menu relative mb-2 rounded-[10px] p-2 anim-in"
            role="region"
            aria-label={t('cap.panel.title', 'Output — {title}', { title: capabilityPanel.title })}
            data-cap-kind={capabilityPanel.kind}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="caps text-[9px] tracking-wide text-faint shrink-0" dir="auto">
                {t('cap.panel.title', 'Output — {title}', { title: capabilityPanel.title })}
              </span>
              <span className="flex-1" />
              <button
                className="stamp !h-[18px] !px-2 !text-[10px] cursor-pointer press shrink-0"
                onClick={() => void copyCapability()}
                title={t('cap.panel.copy', 'Copy output')}
                aria-label={t('cap.panel.copy', 'Copy output')}
              >
                {t('cap.panel.copy', 'Copy output')}
              </button>
              <button
                className="ibtn !w-6 !h-6 shrink-0"
                onClick={dismissCapabilityPanel}
                title={t('cap.panel.close', 'Close output panel')}
                aria-label={t('cap.panel.close', 'Close output panel')}
              >
                <X size={11} />
              </button>
            </div>
            <pre
              className="sc-cap-text m-0 max-h-[190px] overflow-auto whitespace-pre-wrap break-words font-code text-[11.5px] leading-relaxed text-dim"
              dir={capabilityPanel.kind === 'diff' || capabilityPanel.kind === 'test' ? 'ltr' : 'auto'}
            >
              {capabilityPanel.text}
            </pre>
          </div>
        )}

        {/* v12 — prompt-presets quick insert: the saved library, one keystroke
            away. Shares the glass-menu language of the slash menu. */}
        {presetsOpen && (
          <div
            ref={presetsRef}
            className="glass-menu absolute bottom-full mb-2 inset-x-0 max-h-[300px] overflow-hidden p-1.5 z-10 anim-in rounded-[10px] sc-presets"
            role="dialog"
            aria-label={t('presets.title', lang === 'ar' ? 'توجيهات جاهزة' : 'Prompt presets')}
          >
            <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-0.5">
              <BookMarked size={12} className="text-acc shrink-0" aria-hidden />
              <span className="caps text-[9px] tracking-wide text-faint shrink-0">
                {t('presets.title', lang === 'ar' ? 'توجيهات جاهزة' : 'Prompt presets')}
              </span>
              <span className="flex-1" />
              <button
                className="ibtn !w-6 !h-6 shrink-0"
                onClick={() => setPresetsOpen(false)}
                title={t('presets.close', lang === 'ar' ? 'إغلاق' : 'Close')}
                aria-label={t('presets.close', lang === 'ar' ? 'إغلاق' : 'Close')}
              >
                <X size={11} />
              </button>
            </div>
            <div className="relative mb-1.5 px-0.5">
              <Search size={11} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
              <input
                autoFocus
                dir="auto"
                value={presetQuery}
                onChange={(e) => setPresetQuery(e.target.value)}
                placeholder={t('presets.search', lang === 'ar' ? 'ابحث في التوجيهات…' : 'Filter presets…')}
                className="w-full h-7 rounded-[7px] bg-[var(--bg1)] text-[11.5px] ps-7 px-2 outline-none sc-presets-search"
              />
            </div>
            <div className="max-h-[210px] overflow-y-auto flex flex-col gap-0.5 pe-0.5">
              {!presetsLoaded ? (
                <div className="px-2 py-2 text-[11px] text-faint">{t('presets.loading', 'Loading…')}</div>
              ) : shownPresets.length === 0 ? (
                <div className="px-2 py-2 text-[11px] text-faint" dir="auto">
                  {presets.length === 0
                    ? t('presets.empty', lang === 'ar' ? 'لا توجد توجيهات محفوظة بعد — أنشئها من لوحة التوجيهات.' : 'No saved presets yet — create them in the Prompt Library panel.')
                    : t('presets.noMatch', lang === 'ar' ? 'لا نتائج مطابقة' : 'No matching presets')}
                </div>
              ) : (
                shownPresets.map((p) => (
                  <button
                    key={p.id}
                    className="w-full text-start flex items-center gap-2 rounded-[7px] px-2 py-1.5 row-hover cursor-pointer"
                    onClick={() => insertPreset(p)}
                    title={p.text}
                  >
                    <span className="text-[11.5px] font-medium truncate min-w-0 flex-1" dir="auto">{p.name}</span>
                    <span className="text-[10px] text-faint truncate max-w-[46%] shrink-0" dir="auto">
                      {presetPreview(p.text)}
                    </span>
                    <CornerDownLeft size={11} className="text-acc shrink-0" aria-hidden />
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* v11.19/v11.31 — IMMEDIATE local send feedback. Mounts the instant
            `running` flips true (no engine wait): one calm accent dot + the
            localized "Sending…" label (both motion-gated). Fades on the first
            real engine event, when ChatPanel's live run strip takes over. No
            decorative hairline/boxed art. The stop button below stays visible
            and obvious throughout. */}
        {sendPhase !== 'off' && (
          <div
            className={`composer-sending cp-sending${sendPhase === 'out' ? ' is-out' : ''}`}
            data-testid="composer-sending"
            data-state={sendPhase}
            role="status"
            aria-live="polite"
            style={{
              opacity: sendPhase === 'out' ? 0 : 1,
              transition: sendingReduced ? 'none' : 'opacity 220ms ease',
            }}
          >
            <span
              className={`composer-sending-dot w-1.5 h-1.5 rounded-full shrink-0${sendingReduced ? '' : ' animate-pulse'}`}
              style={{ background: 'var(--acc)' }}
              aria-hidden
            />
            <span dir="auto">{t('comp.sending', lang === 'ar' ? 'جارٍ الإرسال…' : 'Sending…')}</span>
            {/* v11.31 — the former `.cp-send-pulse` child is REMOVED: it had
                no stylesheet rule anywhere in the repo, so it was a dead node
                (the "1px sweeping hairline" never existed). The ONE calm, real
                signal is the accent dot + the honest label above. */}
          </div>
        )}

        {/* FINAL POLISH — precise run-progress strip (real phase ledger).
            The existing stop button below stays visible while running. */}
        {runSteps && (
          <div className="cf-run-progress" role="status" aria-label={t('comp.runProgress', 'Run progress')}>
            <span className="cf-run-progress-eyebrow" dir="auto">
              {t('comp.runLabel', lang === 'ar' ? 'قيد التشغيل' : 'RUN')}
            </span>
            <span className="cf-run-progress-track" aria-hidden="true">
              {runSteps.map((s) => <i key={s.phase} data-state={s.state} />)}
            </span>
            <span className="cf-run-progress-mono tnum" dir="ltr">
              {`${runSteps.filter((s) => s.state !== 'pending').length}/${runSteps.length} ${t('comp.phases', 'phases')}`}
            </span>
          </div>
        )}

        {/* control strip: task mode segment · run-state stamps
            TASK A — the segment wraps as a unit on narrow / RTL panels. */}
        <div className="sc-deck-row mb-2" style={{ flexWrap: 'wrap', rowGap: 6 }}>
          <div
            className="stamp-seg is-plain composer-modes-v13 shrink-0"
            role="tablist"
            aria-label={t('comp.taskMode', 'Task mode')}
            data-modestrip="true"
            style={{ display: 'inline-flex', flexWrap: 'wrap', maxWidth: '100%', rowGap: 4, columnGap: 2 }}
          >
            {TASK_MODES.map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={taskMode === m}
                aria-pressed={taskMode === m}
                data-active={taskMode === m ? 'true' : undefined}
                data-mode={m}
                className={`font-code composer-mode-chip${taskMode === m ? ' is-active' : ''}`}
                title={t(TASK_MODE_KEY[m], TASK_MODE_DESC[m])}
                onClick={() => setTaskMode(m)}
                style={{
                  minWidth: modeChipMinWidth,
                  height: 24,
                  flex: '0 0 auto',
                  boxSizing: 'border-box',
                  // inline wins over `.stamp-seg > button { font-family: var(--font-app) }`
                  fontFamily: 'var(--font-mono-x)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: '0 8px',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  textTransform: 'uppercase',
                  textAlign: 'center',
                }}
              >
                {/* BUG FIX — the selected chip used to differ only by a faint
                    background. Carry an explicit check glyph so the active
                    posture is obvious even in high-contrast / monochrome.
                    TASK A — the check slot is RESERVED on every chip, so the
                    active chip never changes the strip's geometry. */}
                <span
                  className="composer-mode-check"
                  style={{ width: 11, height: 11, flex: '0 0 11px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  aria-hidden
                >
                  {taskMode === m && <Check size={9} strokeWidth={3} className="tm-check shrink-0" aria-hidden />}
                </span>
                {/* v7.2 — localized task chips (was fixed BUILD/PLAN/DEBUG/REVIEW) */}
                <span className="composer-mode-label" dir="auto">{t(TASK_MODE_KEY[m], m.toUpperCase())}</span>
              </button>
            ))}
          </div>
          {/* v10.2 — Codex-style worktree picker: where this chat runs */}
          <WorktreeChip />
          <div className="ms-auto flex items-center gap-1.5 min-w-0">
            {steerPending && (
              <span className="stamp stamp-warn !h-[16px] !text-[9px] shrink-0" role="status" dir="auto">
                {t('chat.steerPending', 'STEER PENDING')}
              </span>
            )}
            {running && queuedCount > 0 && (
              <span className="stamp stamp-acc !h-[16px] !text-[9px] tnum" dir="ltr" title={t('chat.queuedHint', 'The agent is busy — your message runs when it finishes')}>
                {`QUEUED ${queuedCount}`}
              </span>
            )}
          </div>
        </div>

        {/* v11.12 — Continue: the last turn was truncated, compacted or failed.
            One click re-sends the SAME task with a continue directive (the store
            owns the decision, so this button can never appear speculatively). */}
        {continueHint && !running && (
          <div className="flex justify-center mb-1.5">
            <button
              className="stamp stamp-warn !h-[20px] !px-2 !text-[10px] cursor-pointer press"
              onClick={() => void continueTask()}
              title={t('chat.continue.title', 'Re-send the last task with a continue instruction')}
              aria-label={t('chat.continue.title', 'Re-send the last task with a continue instruction')}
            >
              <CornerDownLeft size={10} className="shrink-0" aria-hidden />
              <span dir="auto">
                {continueHint.reason === 'compacted'
                  ? t('chat.continue.compacted', 'Continue after compaction')
                  : continueHint.reason === 'error'
                    ? t('chat.continue.error', 'Retry the last task')
                    : t('chat.continue.truncated', 'Continue — the last run stopped early')}
              </span>
            </button>
          </div>
        )}

        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => update(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => refreshCustomCmds()}
          placeholder={
            rtlSafePlaceholder(
              // dir="auto" below: Arabic input types RTL, English LTR; the
              // helper above only fixes the mixed-sigil AR placeholder string
              running ? t('chat.runHint', 'ENTER queue · SHIFT+ENTER steer') : t('chat.placeholder'),
            )
          }
          rows={1}
          dir="auto"
          className="composer-input-v13 w-full bg-transparent outline-none resize-none text-[13.5px] leading-relaxed max-h-[180px] min-h-[38px] placeholder:text-faint select-text"
        />

        {imgs.length > 0 && (
          <div className="kb-attach-strip mt-2">
            {imgs.map((src, i) => (
              <div key={i} className="kb-attach">
                <img src={src} alt="attachment" draggable={false} />
                <button
                  onClick={() => removeImage(i)}
                  className="kb-attach-remove"
                  title={t('chat.removeImage', 'remove')}
                  aria-label={t('chat.removeImage', 'remove')}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* bottom row — left: tools + model chip · right: stop (running) + iris send */}
        <div className="flex items-center gap-2 mt-2 min-w-0">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              void attachFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {/* v11.37 — document picker. It feeds the SAME attachFiles path as
              images/drops; selects document types only. */}
          <input
            ref={docRef}
            type="file"
            accept={DOC_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              void attachFiles(e.target.files);
              e.target.value = '';
            }}
          />

          {/* v11.37 — the three former standalone buttons (attach image,
              prompt presets, checkpoint rewind) are gathered here behind ONE
              "+" trigger, together with the NEW attach-document ability.
              v11.42 added slash commands; v11.43 adds the real '@' file list
              (same capped mentionPaths + insertMention action as the retired
              floating menu). */}
          <AttachMenu
            imageFull={imgs.length >= MAX_IMAGES}
            onAttachImage={() => fileRef.current?.click()}
            onAttachDocument={() => docRef.current?.click()}
            onPresets={togglePresets}
            onRewind={() => void openRewindPicker()}
            mentionPaths={mentionPaths}
            onMentionFile={insertMention}
          />

          {/* v11.37 — effort lives ON the chat, using the model's own two
              stages (standard/deep) through the real updateSettings action. */}
          <EffortControl />

          {/* mic — precise glyph inside a circular waveform ring. The ring
              and orb react to REAL audio amplitude; with no analyser they use
              a gentle, honestly-labelled steady pulse. idle → listening →
              processing → result, each with its own restrained motion. */}
          <VoiceInput
            state={
              voice === 'recording'
                ? 'listening'
                : voice === 'busy'
                  ? 'processing'
                  : voice === 'result'
                    ? 'result'
                    : 'idle'
            }
            level={voiceLevel}
            hasAmplitude={voiceLevelAvailable}
            seconds={voiceSecs}
            transcript={voiceResultText}
            labels={{
              idle: t('chat.voice.title', 'Voice input'),
              listening: t('chat.voice.listening', lang === 'ar' ? 'جارٍ الاستماع…' : 'Listening…'),
              processing: t('chat.voice.processing', lang === 'ar' ? 'جارٍ التفريغ النصي…' : 'Transcribing…'),
              result: t('chat.voice.result', lang === 'ar' ? 'النص جاهز' : 'Transcript ready'),
              stop: t('chat.voice.stop', 'Stop recording'),
              steady: t(
                'chat.voice.steady',
                lang === 'ar' ? 'قياس الصوت غير متاح — نبض ثابت' : 'Level unavailable — steady pulse',
              ),
            }}
            onStart={() => void startVoice()}
            onStop={stopVoice}
          />

          {/* v11.21 — the straight context strip is GONE. The radial context
              orb is MOVED here from the status bar (and the duplicate in the
              chat header is removed): this is the ONLY context ring in the UI,
              directly beside the voice-input mic. It keeps the full lens
              popover — exact tokens, cache split, cost, Compact — and the
              exact 2πr arc from the same real fill. */}
          <ContextLens compact />

          {/* mentionable-file count — hidden at zero */}
          {mentionPaths.length > 0 && (
            <Chip className="!h-[18px] !text-[10px] shrink-0 sc-hide-tight" title={t('comp.mentions', 'files mentioned')}>
              <IcFile size={10} className="shrink-0" />
              <span className="tnum">{mentionPaths.length}</span>
            </Chip>
          )}

          {/* active model chip → opens the model picker. v2.6 RTL: shrink-0 +
              max-w bound it; the inner dir=ltr span keeps provider/model ids
              from bidi-reordering in the Arabic UI */}
          <button
            className="chip font-code tnum !h-[20px] !text-[10px] max-w-[15ch] min-w-0 shrink-0 cursor-pointer hover:!text-[var(--ink)] hover:!border-acc transition-colors"
            title={`${model.provider}/${model.model}`}
            aria-label={t('comp.model', 'Active model')}
            onClick={() => setModelPicker(true)}
          >
            <IcSpark size={10} className="shrink-0" />
            <span className="truncate min-w-0" dir="ltr">
              {shortModel(model.model)}
            </span>
          </button>

          <div className="flex items-center gap-1.5 ms-auto shrink-0">
            {(running || sendPhase === 'on' || sendPhase === 'out') && (
              <button
                className="composer-stop"
                data-testid="composer-stop"
                onClick={() => {
                  // kdx:agent:abort is a REAL abort (the main process aborts the
                  // run's AbortController + resolves pending approvals). Give
                  // immediate visible feedback while the terminal report lands.
                  void abortAgent();
                  notify(t('chat.stopping', 'Stopping the agent…'));
                }}
                title={t('chat.stop', 'Stop')}
                aria-label={t('chat.stop', 'Stop')}
              >
                <IcStop size={13} />
              </button>
            )}
            <button
              className="composer-send press"
              disabled={!value.trim() && imgs.length === 0}
              onClick={send}
              title={
                running
                  ? t('chat.queuedHint', 'The agent is busy — your message runs when it finishes')
                  : t('chat.send', 'Send')
              }
              aria-label={running ? t('chat.queue', 'Queue') : t('chat.send', 'Send')}
            >
              <IcSend size={14} />
            </button>
          </div>
        </div>

        {/* keyboard hint row — faint glass pills (feature-complete:
            quick /commands fill the input; @ mentions hint while typing) */}
        <div className="composer-keys">
          {value.trim().length === 0 && imgs.length === 0 && (
            <span className="agt-quick inline-flex items-center gap-1 shrink-0" dir="ltr">
              <button
                className="composer-agentchip"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertAgentTeam(2)}
                title={t('comp.agents2.tip', 'Insert an instruction to delegate to 2 specialist agents')}
              >
                <b>2</b> {t('comp.agents', 'agents')}
              </button>
              <button
                className="composer-agentchip"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertAgentTeam(3)}
                title={t('comp.agents3.tip', 'Insert an instruction to delegate to 3 specialist agents')}
              >
                <b>3</b> {t('comp.agents', 'agents')}
              </button>
            </span>
          )}
          <span className="kbd-hint">
            <b>↵</b>
            <span dir="auto">{running ? t('chat.queue', 'Queue') : t('chat.send', 'Send')}</span>
          </span>
          <span className="kbd-hint">
            <b>⇧↵</b>
            <span dir="auto">{running ? t('chat.steer', 'Steer') : t('sc.newline', 'New line')}</span>
          </span>
          {value.trim().length === 0 && imgs.length === 0 ? (
            <>
              <span className="kbd-hint" aria-hidden>/</span>
              <div className="sc-slashhint min-w-0 flex-1" dir="ltr" aria-hidden>
                {QUICK_COMMANDS.map((c) => (
                  <button
                    key={c}
                    tabIndex={-1}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setValue(c);
                      setSuppressed('slash');
                      setActiveIdx(0);
                      taRef.current?.focus();
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <span className="kbd-hint min-w-0">
              <b>@</b>
              <span className="truncate" dir="auto">{t('chat.hintMention', 'mention files')}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** One-line chip summary of a queued message. */
function truncChip(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 60 ? `${one.slice(0, 60)}…` : one;
}

export default Composer;
