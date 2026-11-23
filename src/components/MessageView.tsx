// MessageView — renders one chat message: user bubble, assistant markdown
// (GFM + highlight, streaming pulse dot + rAF-smoothed text growth),
// terminal-grade collapsible <thinking> blocks (v11.9: LIVE while the
// turn streams — BARE streaming reasoning in --think-ink ink, tail-pinned
// autoscroll, seconds ticker, pulsing dot write-head, NO card frame — then
// ONE unboxed "Thought for Ns" row, expandable with copy), a hover action
// bar (copy · retry · model stamp), code blocks with a language chip + copy
// button, and v11.8 tool rows (.tl2-*/.sc18-* — verb-coded tool icon ·
// READ/EDIT/RUN/SEARCH/BROWSER/MCP verb · primary argument as text ·
// OK 512ms status chip · structured pretty-args drawer — the raw-JSON
// leak is DEAD — plus compact inline results: first 6 lines, expandable,
// errors tinted).
//
// Rows are memoized (React.memo + stable props) — long sessions must stay
// smooth while a new answer streams in.
// v2.3.0 UI-3: also exports the tool-icon map + arg summarizer so the
// ChatPanel run-status pill speaks the same visual language.
import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  Accessibility,
  AlertTriangle,
  BookOpen,
  Bug,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Copy,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  FolderOpen,
  Gauge,
  GitBranch,
  GitCompareArrows,
  Globe,
  GraduationCap,
  Hammer,
  Hash,
  Image as ImageIcon,
  ImagePlus,
  Keyboard,
  ListChecks,
  Map as MapIcon,
  MonitorPlay,
  MousePointerClick,
  PenLine,
  Play,
  Plug,
  Radar,
  RotateCcw,
  ScanEye,
  ScanSearch,
  ScrollText,
  Shapes,
  SearchCode,
  ShieldCheck,
  Square,
  Table2,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  Users,
  Variable,
  Workflow,
  Wrench,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Components } from 'react-markdown';
import type { ChatMessage, ReviewFinding, TodoItem } from '../../shared/types';
import { api } from '../lib/api';
import { useStore } from '../store';
import { useT, useDigits } from '../i18n';
import { Chip, fmtCost, Kbd, shortModel, Spinner } from './ui';
import { DiffView, diffInputsFromToolArgs } from './DiffView';
// v11.35 — APP errors (429 / quota / provider 503 / network / auth) get a calm
// hairline instrument instead of the old tinted .error-card text dump.
import { ErrorNotice, isGenuineAppError } from './ErrorNotice';
// v11.11 (wave2-A1) — the drain math lives in a pure, unit-tested lib.
// v11.22 — the app logo + descending-line glyph is GONE from the thinking head;
// the precision circle in this file is the only mark there now (brand import removed).
import { drainStepChars, formatDoneDuration } from '../lib/streamDisplay';
// v11.11 (wave3-A2) — the per-tool visual language: one FAMILY per tool
// (write/edit/read/bash/browser/mcp/think/other) + the consecutive-run
// stack grouper ("read_file ×3"). Pure + unit-tested lib.
import { toolFamilyOf, toolRunOrdinal, type ToolFamily } from '../lib/toolGrouping';

// v2.3 icon grammar — one glyph per tool family, directionally neutral.
// read=FileText · write/edit=PenLine · run=Terminal · web=Globe ·
// download=Download · search=SearchCode · plan=ListChecks · task=Users ·
// preview=MonitorPlay · screenshot=Camera · mcp=Plug · default=Wrench.
// v3: background=Play · output=ScrollText · stop=Square.
// v11.9 (D7): the browser_* family stops falling back to Wrench —
// navigate=Globe · click=MousePointerClick · type=Keyboard · read=BookOpen ·
// snapshot/screenshot=Camera · eval=Terminal · close=X.
export const TOOL_ICONS: Record<string, LucideIcon> = {
  list_dir: FolderOpen,
  read_file: FileText,
  write_file: PenLine,
  edit_file: PenLine,
  run_command: Terminal,
  run_background: Play,
  process_output: ScrollText,
  stop_process: Square,
  preview_screenshot: Camera,
  search_files: SearchCode,
  todo_write: ListChecks,
  task: Users,
  web_fetch: Globe,
  download: Download,
  download_file: Download,
  preview: MonitorPlay,
  screenshot: Camera,
  // browser_* (D7)
  browser_navigate: Globe,
  browser_click: MousePointerClick,
  browser_type: Keyboard,
  browser_read: BookOpen,
  browser_snapshot: Camera,
  browser_screenshot: Camera,
  browser_eval: Terminal,
  browser_close: X,
  // engine families that had no glyph yet (search / test / debug / meta)
  code_search: SearchCode,
  web_search: Globe,
  search_web: Globe,
  test_run: FlaskConical,
  lint_check: ListChecks,
  debug_start: Bug,
  debug_state: Bug,
  debug_eval: Bug,
  debug_step: Bug,
  debug_stop: Bug,
  image_generate: ImageIcon,
  worktree_create: FolderOpen,
  worktree_remove: FolderOpen,
  ask_user: UserRound,
  use_skill: BookOpen,
  // power tools — data / perf / QA / audit. Anything unmapped still
  // degrades to the neutral Wrench via toolIcon() (no false glyphs).
  db_query: Database,
  lighthouse: Gauge,
  e2e_run: FlaskConical,
  e2e_test: FlaskConical,
  a11y_audit: Accessibility,
  env_manager: Variable,
  git_platform: GitBranch,
  image_edit: ImagePlus,
  icon_font_search: Shapes,
  csv_read: FileSpreadsheet,
  csv_write: FileSpreadsheet,
  pdf_read: FileText,
  hash_file: Hash,
  diff_files: GitCompareArrows,
  image_search: ScanSearch,
  audit_run: Radar,
  plan_propose: Workflow,
};

export function toolIcon(name?: string): LucideIcon {
  if (!name) return Wrench;
  if (name.startsWith('mcp__')) return Plug;
  return TOOL_ICONS[name] ?? Wrench;
}

// ---------------------------------------------------------------------------
// TOOL STORY GLYPHS — a precise 1px-stroke instrument glyph per tool FAMILY.
// The founder's brief: "using the tools should have its own distinctive, modern
// graphics". Eight marks, each drawn on an EXACT 16×16 grid centred on (8,8):
//   file   = pen on paper   · command = terminal pulse  · search = magnifier sweep
//   web    = globe arc      · db      = cylinder        · test   = checkmark track
//   lsp    = node graph     · image   = frame           · tool   = printer's star
// Every stroke is currentColor at width 1; no fill, no gradient, no glow, no
// rounded card. Radial work uses real trigonometry (equal angular spacing), so
// nothing is "off by a pixel". Presentation only — no store/cadence contract.
// ---------------------------------------------------------------------------
export type StoryGlyphKind = 'file' | 'command' | 'search' | 'web' | 'db' | 'test' | 'lsp' | 'image' | 'tool';

type GlyphFamily = Exclude<StoryGlyphKind, 'tool'>;

/** Membership is ordered: a screenshot is an image before it is a web browser. */
const STORY_SETS: Record<GlyphFamily, ReadonlySet<string>> = {
  image: new Set([
    'image_generate', 'image_edit', 'image_search', 'image_probe', 'screenshot',
    'preview_screenshot', 'browser_screenshot', 'browser_snapshot', 'gen_ui',
    'media_ffmpeg', 'pdf_make',
  ]),
  db: new Set([
    'db_query', 'db_seed', 'db_migrate', 'sqlite_query', 'csv_read', 'csv_write',
    'pdf_read', 'env_manager', 'hash_file', 'json_format', 'make_document',
    'docx_make', 'pptx_make', 'xlsx_make', 'notebook_read', 'notebook_edit_cell',
  ]),
  test: new Set([
    'test_run', 'lint_check', 'e2e_run', 'a11y_audit', 'lighthouse',
    'memory_verify', 'regex_test', 'verify', 'audit_run', 'ui_quality_check',
  ]),
  lsp: new Set([
    'lsp_definition', 'lsp_hover', 'lsp_diagnostics', 'lsp_references',
    'lsp_rename', 'lsp_completion', 'find_refs', 'symbol_outline', 'impact_of',
    'repo_map', 'semantic_search', 'workspace_map', 'debug_start', 'debug_state',
    'debug_eval', 'debug_step', 'debug_stop',
  ]),
  command: new Set([
    'run_command', 'run_background', 'process_output', 'stop_process',
    'process_list', 'process_kill', 'browser_eval', 'browser_console_eval',
    'git_local', 'git_platform', 'env_probe', 'port_probe', 'sys_info',
    'network_info', 'device_launch_app', 'desktop_control', 'archive_create',
    'archive_extract', 'export_project', 'move_path', 'delete_path',
    'reveal_in_folder', 'create_pull_request', 'pr_status', 'http_request',
    'notebook_run',
  ]),
  search: new Set([
    'search_files', 'search_grep', 'code_search', 'grep', 'glob_files',
    'fs_browse', 'icon_font_search', 'search_web', 'web_search',
  ]),
  web: new Set([
    'browser_navigate', 'browser_click', 'browser_type', 'browser_read',
    'browser_close', 'browser_tabs', 'browser_network', 'browser_download',
    'browser_console', 'browser_pdf', 'browser_wait_for', 'browser_select',
    'open_path', 'web_fetch', 'preview', 'download', 'download_file',
    'diagnose_preview', 'url_encode', 'url_decode', 'clipboard_read',
    'clipboard_write',
  ]),
  file: new Set([
    'write_file', 'edit_file', 'multi_edit', 'multi_file_edit', 'read_file',
    'read_image', 'list_dir', 'todo_write', 'task', 'use_skill', 'create_skill',
    'propose_plan', 'plan_propose', 'checkpoint_save', 'checkpoint_list',
    'checkpoint_restore', 'pin_context', 'remember', 'recall_memory',
    'recall_result', 'dna_note', 'diff_stat', 'diff_files', 'markdown_outline',
    'schema_docs', 'notify_user', 'ask_user', 'color_convert', 'text_stats',
    'uuid_gen', 'encode_base64', 'decode_base64',
  ]),
};

/** Tool name → story glyph family (mcp__* deliberately degrades to the neutral star). */
export function toolGlyphOf(name?: string): StoryGlyphKind {
  if (!name) return 'tool';
  for (const k of Object.keys(STORY_SETS) as GlyphFamily[]) {
    if (STORY_SETS[k].has(name)) return k;
  }
  return 'tool';
}

/** LSP node graph — three nodes at EXACTLY 120° apart on r=4.6 about (8,8). */
const LSP_NODES = ([-90, 30, 150] as const).map((deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: 8 + 4.6 * Math.cos(a), y: 8 + 4.6 * Math.sin(a) };
});

/** The artwork for each family (a <g> supplies stroke/currentColor at 1px). */
const STORY_ART: Record<StoryGlyphKind, React.ReactNode> = {
  // pen on paper: sheet x3.2..12.8 / y2.4..13.6, fold corner at (8.8,6.4),
  // a 45° pen body with its nib touching the page at (5.2,13.9).
  file: (
    <>
      <path d="M3.2 2.4h5.6l4 4v7.2H3.2z" />
      <path d="M8.8 2.4v4h4" />
      <path d="M6.6 11.7 12.1 6.2l1.2 1.2-5.5 5.5z" />
      <path d="M6.6 11.7 5.2 13.9l2.6-1z" />
    </>
  ),
  // terminal: a 1px frame centred on (8,8), a prompt chevron and a live ECG pulse.
  command: (
    <>
      <path d="M2.4 3.2h11.2v9.6H2.4z" />
      <path d="M2.4 5.8h11.2" />
      <path d="m4.4 8.1 1.9 1.9-1.9 1.9" />
      <path className="tsg-pulse" d="M7.4 10h1l.6-1.2.7 2.3.7-1.5h1.4" />
    </>
  ),
  // magnifier: lens centre (7,7) r4.3; handle begins exactly on the lens at
  // 45° — (7+4.3/√2, 7+4.3/√2) = (10.04,10.04). The sweep ray is CSS-rotated
  // about (7,7).
  search: (
    <>
      <circle cx="7" cy="7" r="4.3" />
      <path d="M10.04 10.04 13.4 13.4" />
      <path className="tsg-sweep" d="M7 7V3.2" />
    </>
  ),
  // globe: circle r6 centred on (8,8), a true ellipse meridian (rx2.5 ry6),
  // two latitude chords and a top-half arc that CSS sweeps about the centre.
  web: (
    <>
      <circle cx="8" cy="8" r="6" />
      <ellipse cx="8" cy="8" rx="2.5" ry="6" />
      <path d="M2.5 5.6h11M2.5 10.4h11" />
      <path className="tsg-sweep" d="M2 8a6 6 0 0 1 12 0" />
    </>
  ),
  // cylinder: an exact ellipse cap (cx8 cy3.8 rx5 ry1.9), two vertical walls
  // and two DOWNWARD minor arcs for the visible front bands. In SVG's y-down
  // coordinate system sweep=0 (negative angle / counter-clockwise on screen)
  // from the left rim (x3) to the right rim (x13) dips through the ellipse's
  // lower half (y = cy + ry); sweep=1 would arc UP through y = cy − ry and
  // draw an inverted, bowl-shaped "cylinder". Precision fix: sweep=0.
  db: (
    <>
      <ellipse cx="8" cy="3.8" rx="5" ry="1.9" />
      <path d="M3 3.8v8.4M13 3.8v8.4" />
      <path d="M3 12.2a5 1.9 0 0 0 10 0" />
      <path d="M3 8a5 1.9 0 0 0 10 0" />
    </>
  ),
  // checkmark track: a rail with three evenly spaced stations (8±4.8) and a
  // two-segment ink check that draws on settle.
  test: (
    <>
      <path d="M2.4 8h11.2" />
      <circle cx="3.2" cy="8" r="1.1" />
      <circle cx="8" cy="8" r="1.1" />
      <circle cx="12.8" cy="8" r="1.1" />
      <path className="tsg-ink" d="m6.4 3.9 1.6 1.6 3.1-3.1" />
    </>
  ),
  // node graph: exact trig positions, a centre hub, spokes and the outer hull.
  lsp: (
    <>
      <path d={LSP_NODES.map((p) => `M8 8  ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('')} />
      <path d={`M${LSP_NODES.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}Z`} />
      <circle cx="8" cy="8" r="1.1" />
      {LSP_NODES.map((p, i) => (
        <circle key={i} cx={p.x.toFixed(2)} cy={p.y.toFixed(2)} r="1.35" />
      ))}
    </>
  ),
  // frame: a 1px picture frame centred on (8,8), a sun and a mountain ridge
  // that lands exactly on the frame's right edge (13.6,11.4).
  image: (
    <>
      <path d="M2.4 3.2h11.2v9.6H2.4z" />
      <circle cx="5.8" cy="6.2" r="1.25" />
      <path d="m2.4 11.4 3.3-3.5 2.5 2.5 2.2-2.4 3.2 3.4" />
    </>
  ),
  // neutral printer's star — symmetric about (8,8).
  tool: <path d="M8 2.2 9.5 6.5 13.8 8 9.5 9.5 8 13.8 6.5 9.5 2.2 8 6.5 6.5Z" />,
};

/** The satisfying settle overlays: one ink check (done) / one quiet cross (error). */
function StoryGlyph({ name }: { name?: string }) {
  const kind = toolGlyphOf(name);
  return (
    <span className="tsg" data-glyph={kind} aria-hidden>
      <svg viewBox="0 0 16 16" focusable="false" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        <g className="tsg-art">{STORY_ART[kind]}</g>
        <path className="tsg-settle tsg-check" d="m4.2 8.2 2.6 2.6 5-5.4" />
        <path className="tsg-settle tsg-cross" d="M5.2 5.2 10.8 10.8M10.8 5.2 5.2 10.8" />
      </svg>
    </span>
  );
}

/**
 * The ONE source of truth for the progress-ring radius. r=5 in a 14×14
 * viewBox leaves 2px on every side — with the 1.6px ring stroke the outer
 * edge lands at 5.8, i.e. 1.2px of clear margin. Both renderers use it.
 */
export const RING_RADIUS = 5;
/** Exact circumference — do NOT round: the dash array must equal 2πr (≈31.4159). */
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * A real-data progress ring: the arc length is the exact circumference
 * 2πr (r=5 → 31.41592653589793) and the fill offset is derived from
 * done/total only. Both numbers are passed at FULL float precision — rounding
 * the dash array to 2dp (31.42) made a "100%" ring overshoot its own track by
 * ≈0.004 and left a hairline seam; no invented percentages, no rounded arcs.
 * Used by plan/checkpoint steps and subagent work.
 */
function ProgressRing({ done, total, size = 14 }: { done: number; total: number; size?: number }) {
  const circ = RING_CIRCUMFERENCE;
  const value = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  return (
    <span
      className="ts-ring"
      style={{ width: size, height: size } as React.CSSProperties}
      aria-hidden
    >
      <svg viewBox="0 0 14 14" focusable="false" fill="none">
        <circle className="ts-ring-track" cx="7" cy="7" r={RING_RADIUS} />
        <circle
          className="ts-ring-fill"
          cx="7"
          cy="7"
          r={RING_RADIUS}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - value)}
        />
      </svg>
    </span>
  );
}

// v11.24 — the trembling streaming ornaments are GONE. The former live wave,
// nib/spark and five-bead rail all moved on REAL delta word counts, but the
// founder saw them as trembling decoration next to the answer. Streaming text
// is now PLAIN, STABLE text; the only animated instrument in the transcript is
// the single precision circle in the reasoning head (PrecisionThinkingOrbit),
// and the single small circle in the run/timeline strip (ChatPanel).
// No per-delta word counting, keyed word spans or CSS shimmer remain here.

/**
 * The per-tool completion bloom. Mounted ONLY when a tool card's data-status
 * flips to 'done' — so it mounts once and A15's one-shot CSS plays a single
 * check + radiating ring (no loop, no re-trigger on unrelated store ticks).
 * Same art grammar as the settle overlays: 16×16, currentColor, 1px stroke.
 * The ring r=5 spans x/y 3..13 (2px clear margin); the check is the exact
 * `tsg-check` path, landing inside the ring.
 */
function ToolBloom() {
  return (
    <span className="mv-tool-bloom" aria-hidden>
      <svg viewBox="0 0 16 16" focusable="false" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        <circle className="mv-bloom-ring" cx="8" cy="8" r="5" />
        <path className="mv-bloom-check" d="m4.2 8.2 2.6 2.6 5-5.4" />
      </svg>
    </span>
  );
}

// Defensive: an untrusted IPC row may omit `content`; trunc must never throw
// in render (it is used for the DNA feedback excerpt of every assistant row).
const trunc = (s: string | undefined | null, n: number): string => {
  const v = s ?? '';
  return v.length > n ? `${v.slice(0, n)}…` : v;
};

/** Fixed-width oscilloscope readout for the live thinking rail (mm:ss). */
function fmtThinkElapsed(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The faint registration plate drawn in a transcript row's leading gutter:
 * a crosshair, a 1px top hairline that draws in on mount and — on assistant
 * turns — a mono plate serial. Purely decorative (aria-hidden, absolutely
 * positioned, never in the reading flow).
 */
function PlateOrnament({ serial }: { serial?: string }) {
  return (
    <span className="sc-plate" aria-hidden>
      <span className="sc-plate-cross" />
      <span className="sc-plate-rule" />
      {serial && <span className="sc-plate-index" dir="ltr">{serial}</span>}
    </span>
  );
}

/** Reduced-motion gate for the ONE animated instrument in this file — the
 *  precision circle in the reasoning head. v11.26: now checks BOTH switches,
 *  exactly like the THINK-band circle (StreamTimeline's ThinkOrbit): the OS
 *  `prefers-reduced-motion: reduce` media query AND the in-app
 *  `html.reduce-motion` class. When either is on, the orbit renders its frozen
 *  end state with zero SMIL elements. The former per-message gutter circle was
 *  deleted, not hidden (it now lives in the run/timeline strip, owned by
 *  ChatPanel). */
function usePrefersReducedMotion(): boolean {
  const [reduced] = useState(
    () =>
      (typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
      (typeof document !== 'undefined' &&
        !!document.documentElement.classList.contains('reduce-motion')),
  );
  return reduced;
}

/**
 * Power tools — the data / perf / QA / audit tier already mapped in
 * TOOL_ICONS. They wear their existing lucide glyph a second time, engraved
 * inside the family chip, so the card reads at a glance with no new icon.
 */
const POWER_TOOLS: ReadonlySet<string> = new Set([
  'db_query',
  'lighthouse',
  'e2e_run',
  'e2e_test',
  'a11y_audit',
  'env_manager',
  'git_platform',
  'image_edit',
  'icon_font_search',
  'csv_read',
  'csv_write',
  'pdf_read',
  'hash_file',
  'diff_files',
  'image_search',
  'audit_run',
  'plan_propose',
]);

// Todo checklist rows — shared with ChatPanel's live-plan card (same visual style).
// done → struck + faint · in_progress → pulsing sage dot · pending → dim.
export function TodoRows({ todos }: { todos: TodoItem[] }) {
  // Real-data step ring: only completed/total from the actual todo list —
  // the arc fills as steps land, never a fabricated percentage.
  const done = todos.filter((td) => td.status === 'completed').length;
  return (
    <div className="flex flex-col gap-1">
      <div className="ts-plan-progress" aria-hidden>
        <ProgressRing done={done} total={todos.length} size={14} />
        <span className="ts-plan-count tnum" dir="ltr">{done}/{todos.length}</span>
      </div>
      {todos.map((td) => {
        const done = td.status === 'completed';
        const active = td.status === 'in_progress';
        return (
          <div
            key={td.id}
            className={`flex items-center gap-2 text-[11.5px] min-w-0 ${done ? 'opacity-55' : active ? '' : 'opacity-75'}`}
          >
            {done ? (
              <CheckCircle2 size={12} className="text-ok shrink-0" />
            ) : active ? (
              <span className="w-2 h-2 rounded-full bg-acc pulse-dot shrink-0" aria-hidden />
            ) : (
              <Circle size={12} className="text-faint shrink-0" />
            )}
            <span
              className={`truncate min-w-0 ${done ? 'line-through text-faint' : active ? 'text-ink font-medium' : 'text-dim'}`}
              dir="auto"
            >
              {td.content}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function timeStr(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------- clipboard helpers ----------------
/**
 * v11.31 — HONEST COPY. The old helper returned `true` even when the clipboard
 * was absent or the write rejected (it `void`-ed the promise), so three copy
 * buttons painted a green "Copied" over a failed action. Now the REAL promise
 * is awaited and the actual outcome is returned; only a resolved write counts.
 */
async function copyText(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 'Copied' flash — set ONLY after a real write; a failure toasts honestly and
 *  never paints a false success. Timer is cleaned up on unmount. */
function useCopyFeedback(): { copied: boolean; copy: (text: string) => Promise<void> } {
  const t = useT();
  const ar = useStore((s) => s.settings?.language === 'ar');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async (text: string) => {
    if (!(await copyText(text))) {
      useStore.getState().notify(t('chat.copyFailed', ar ? 'تعذّر النسخ' : 'Could not copy'));
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };
  return { copied, copy };
}

// ---------------- <thinking> segment parser ----------------
interface ContentSegment {
  type: 'md' | 'thinking';
  text: string;
}

const THINK_OPEN = '<thinking>';
const THINK_CLOSE = '</thinking>';
// v11.4 — <think>…</think> is the same reasoning channel under a shorter
// alias (Qwen3 / DeepSeek-R1 transcripts): parsed identically so historical
// transcripts render their reasoning in the Thinking block, never as answer
// markdown.
const THINK_ALIASES: ReadonlyArray<{ open: string; close: string }> = [
  { open: THINK_OPEN, close: THINK_CLOSE },
  { open: '<think>', close: '</think>' },
];

/**
 * True when `idx` sits inside an open ``` fence (i.e. the tag is example
 * content inside a code block and must stay as-is in the markdown).
 * Exception: a bare fence line directly above the tag is the runtime's
 * wrapped-thinking form, not a code block, so it does NOT count as "inside".
 */
function insideFence(raw: string, idx: number): boolean {
  // start of the line containing idx
  let tagLineStart = idx;
  while (tagLineStart > 0 && raw[tagLineStart - 1] !== '\n') tagLineStart--;
  let depth = 0;
  let lastOpenLineStart = -1;
  let lastOpenBare = false;
  let lineStart = 0;
  for (let i = 0; i < tagLineStart; i++) {
    if (raw[i] === '\n') {
      const line = raw.slice(lineStart, i);
      if (/^[ \t]*```/.test(line)) {
        depth++;
        lastOpenLineStart = lineStart;
        lastOpenBare = /^[ \t]*```[ \t]*$/.test(line);
      }
      lineStart = i + 1;
    }
  }
  if (depth % 2 === 0) return false;
  // odd depth — a fence is open. If it is a bare fence on the immediately
  // preceding line, it is the ```\n<thinking>… wrapper, not a code block.
  if (depth === 1 && lastOpenLineStart >= 0 && lastOpenBare) {
    if (/^```[ \t]*\n+$/.test(raw.slice(lastOpenLineStart, tagLineStart))) return false;
  }
  return true;
}

/** Minimal hast node shape (only what the text walker needs). */
interface HastNode {
  type?: string;
  value?: string;
  tagName?: string;
  children?: HastNode[];
  position?: { start?: { line?: number } };
}

function hastText(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  let out = '';
  for (const c of node.children ?? []) out += hastText(c);
  return out;
}

/**
 * Split assistant content into markdown / thinking segments.
 * Recognized forms:
 *   1. bare `<thinking>…</thinking>` tags (streamed inline by the agent);
 *      `<think>…</think>` is accepted as an exact alias of the same form;
 *   2. the same tags wrapped in ``` fences — the fences are swallowed;
 *   3. a ```thinking fenced block (```think alias accepted too).
 * An unclosed block (streaming tail) is treated as thinking so the raw tag
 * never flashes as message text. The tags themselves are never rendered.
 */
function splitContent(raw: string | undefined | null): ContentSegment[] {
  const segs: ContentSegment[] = [];
  // Defensive: an untrusted IPC row may omit `content`. Never throw in render.
  if (typeof raw !== 'string' || raw.length === 0) return segs;
  const pushMd = (text: string) => {
    if (text.trim().length > 0) segs.push({ type: 'md', text });
  };
  let pos = 0;
  while (pos < raw.length) {
    // earliest opening tag across the <thinking>/<think> aliases
    let tagIdx = -1;
    let openLen = 0;
    let closeTag = THINK_CLOSE;
    for (const alias of THINK_ALIASES) {
      const i = raw.indexOf(alias.open, pos);
      if (i >= 0 && (tagIdx === -1 || i < tagIdx)) {
        tagIdx = i;
        openLen = alias.open.length;
        closeTag = alias.close;
      }
    }
    // D15 — the opening ```thinking fence no longer requires a trailing
    // newline: a fence at EOF (streaming tail that just opened, or a persisted
    // block whose file ends right after the fence line) is a valid opener.
    const fenceRe = /(^|\n)[ \t]*```[ \t]*(?:thinking|think)[ \t]*(?:\n|$)/g;
    fenceRe.lastIndex = pos;
    const fenceM = fenceRe.exec(raw);

    let useTag = false;
    let open = -1;
    let bodyStart = -1;
    let pre = 0;

    if (tagIdx >= 0 && (fenceM === null || tagIdx <= fenceM.index)) {
      if (insideFence(raw, tagIdx)) {
        // the tag is example content inside a code block — keep scanning;
        // the surrounding md segment stays intact and includes the tag
        pos = tagIdx + openLen;
        continue;
      }
      useTag = true;
      open = tagIdx;
      bodyStart = tagIdx + openLen;
      // swallow a wrapping fence line immediately before the tag
      const before = raw.slice(pos, open);
      const fb = /(?:^|\n)[ \t]*```[ \t]*\n?$/.exec(before);
      if (fb) pre = fb[0].length - (fb[0].startsWith('\n') ? 1 : 0);
    } else if (fenceM && !insideFence(raw, fenceM.index)) {
      open = fenceM.index + fenceM[1].length; // start of the ```thinking line
      bodyStart = fenceM.index + fenceM[0].length; // after the fence line
      pre = fenceM[1].length; // keep the preceding newline in the md segment
    } else if (fenceM) {
      // rejected ```thinking inside another fence — keep scanning past it
      pos = fenceM.index + fenceM[0].length;
      continue;
    } else {
      pushMd(raw.slice(pos));
      break;
    }

    let bodyEnd: number;
    let after: number;
    if (useTag) {
      const closeIdx = raw.indexOf(closeTag, bodyStart);
      if (closeIdx === -1) {
        bodyEnd = raw.length;
        after = raw.length;
      } else {
        bodyEnd = closeIdx;
        after = closeIdx + closeTag.length;
        const fa = /^[ \t]*\n?[ \t]*```[ \t]*(?:\n|$)/.exec(raw.slice(after));
        if (fa) after += fa[0].length;
      }
    } else {
      const closeFence = raw.indexOf('```', bodyStart);
      if (closeFence === -1) {
        bodyEnd = raw.length;
        after = raw.length;
      } else {
        bodyEnd = closeFence;
        const nl = raw.indexOf('\n', closeFence);
        after = nl === -1 ? raw.length : nl + 1;
      }
    }

    pushMd(raw.slice(pos, open - pre));
    segs.push({ type: 'thinking', text: raw.slice(bodyStart, bodyEnd).replace(/^\n+/, '') });
    pos = after;
  }
  return segs;
}

/**
 * v11.3 — NoticeChip: harness notices (gates, verifiers, compaction,
 * failover, progress) as a quiet hairline chip. These NEVER render inside
 * the answer markdown again — the channel split guarantees a clean reply.
 */
const NOTICE_META: Record<string, { en: string; ar: string }> = {
  verify: { en: 'VERIFY', ar: 'تحقق' },
  uiq: { en: 'UI CHECK', ar: 'فحص الواجهة' },
  goal: { en: 'GOAL', ar: 'الهدف' },
  critic: { en: 'CRITIC', ar: 'نقد' },
  audit: { en: 'CLAIM AUDIT', ar: 'تدقيق الادعاءات' },
  redgreen: { en: 'RED→GREEN', ar: 'أحمر←أخضر' },
  regression: { en: 'REGRESSION', ar: 'انحدار' },
  fake: { en: 'FAKE-TEST', ar: 'اختبار وهمي' },
  mutation: { en: 'MUTATION', ar: 'تحور' },
  proof: { en: 'PROOF', ar: 'إثبات' },
  guard: { en: 'GUARD', ar: 'حارس' },
  compact: { en: 'COMPACT', ar: 'ضغط' },
  failover: { en: 'FAILOVER', ar: 'تحويل' },
  gate: { en: 'GATE', ar: 'بوابة' },
  checkpoint: { en: 'CHECKPOINT', ar: 'نقطة استعادة' },
  review: { en: 'REVIEW', ar: 'مراجعة' },
  continue: { en: 'CONTINUE', ar: 'متابعة' },
  stop: { en: 'STOPPED', ar: 'توقف' },
  progress: { en: 'AGENT', ar: 'وكيل' },
  mode: { en: 'MODE', ar: 'الوضع' },
  sys: { en: 'SYSTEM', ar: 'نظام' },
  // v12 — the single 20s "still reasoning" liveness marker. Rendered as a
  // TINY mono line (console.css `.sc-notice[data-notice='thinking']`), never
  // as the default hairline chip/box. The dot beside it is the liveness hook;
  // the separate renderer watchdog (runRecovery) is untouched.
  thinking: { en: 'THINK', ar: 'تفكير' },
};

/**
 * Task-mode / checkpoint notices get a real visual stamp (icon + tinted
 * square + caps word) instead of being a plain text line. The engine writes
 * the mode into the notice content ("BUILD mode…" / Arabic equivalent), so
 * detection stays read-only and degrades to a neutral MODE chip if unknown.
 */
type TaskModeKey = 'build' | 'plan' | 'debug' | 'review';
const MODE_STAMP: Record<TaskModeKey, { Icon: LucideIcon; color: string; en: string; ar: RegExp }> = {
  build: { Icon: Hammer, color: 'var(--acc)', en: 'BUILD', ar: /البناء/ },
  plan: { Icon: MapIcon, color: 'var(--v-think)', en: 'PLAN', ar: /الخطة/ },
  debug: { Icon: Bug, color: 'var(--v-run)', en: 'DEBUG', ar: /الفحص/ },
  review: { Icon: ScanEye, color: 'var(--v-read)', en: 'REVIEW', ar: /المراجعة/ },
};

/**
 * Original printer's-mark monograms for the mode / checkpoint stamps — small
 * hand-drawn geometric glyphs (a set square, a draft grid, a circuit node, a
 * lens with a check, a bookmarked plate). NOT copied from any icon set; each
 * mode gets a distinct mark so the stamp reads at a glance in either script.
 * Purely decorative — the caps word beside it carries the actual label.
 */
type StampKey = TaskModeKey | 'checkpoint';
const STAMP_MARKS: Record<StampKey, React.ReactNode> = {
  // set square + baseline — the builder's instrument
  build: (
    <>
      <path d="M3 12.5 12.5 3 13.6 4.1 5.2 12.5Z" />
      <path d="M2.5 12.5h11" />
      <path d="M9.8 3h3.7v3.7" opacity=".6" />
    </>
  ),
  // draft grid + crosshair — the plan laid out before work
  plan: (
    <>
      <path d="M2.5 2.5h11v11h-11Z" opacity=".55" />
      <path d="M8 2.5v11M2.5 8h11" opacity=".55" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  // circuit node with a traced break — the debug probe. Spokes now meet the
  // r2.1 hub EXACTLY (8±2.1 → 5.9/10.1) and the diagonals land on the circle
  // at 225°/45° ((8−2.1/√2, 8−2.1/√2) = 6.52) instead of stopping short.
  debug: (
    <>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 2.4V5.9M8 10.1v3.5M2.4 8h3.5M10.1 8h3.5" />
      <path d="M4 4 6.52 6.52M9.48 9.48 12 12" opacity=".55" />
    </>
  ),
  // lens with a verified tick — the reviewer's eye
  review: (
    <>
      <path d="M1.6 8S4.2 4.4 8 4.4 14.4 8 14.4 8 11.8 11.6 8 11.6 1.6 8 1.6 8Z" />
      <circle cx="8" cy="8" r="1.7" />
      <path d="m5.3 8.1 1.8 1.8 3.6-3.8" />
    </>
  ),
  // bookmarked plate — a saved checkpoint on the timeline
  checkpoint: (
    <>
      <path d="M4 2.5h8v11l-4-2.6-4 2.6Z" />
      <path d="M6 6h4" opacity=".6" />
    </>
  ),
};

/** The 1px-bordered square monogram stamp: original glyph + mono caps word. */
function MonogramStamp({ kind, word, color }: { kind: StampKey; word: string; color: string }) {
  return (
    <span className="sc-mode-stamp sc-monogram-stamp" style={{ '--mode-c': color } as React.CSSProperties}>
      <span className="sc-notice-mode-ico" aria-hidden>
        <svg viewBox="0 0 16 16" focusable="false" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          {STAMP_MARKS[kind]}
        </svg>
      </span>
      <span className="sc-notice-tag" dir="ltr">
        {word}
      </span>
    </span>
  );
}
/** Kinds that mean "the run is still alive" — never render as a disconnect. */
const CONTINUITY_KINDS: ReadonlySet<string> = new Set(['compact', 'continue', 'progress', 'failover', 'gate']);

function taskModeOf(content: string): TaskModeKey | null {
  for (const key of Object.keys(MODE_STAMP) as TaskModeKey[]) {
    if (new RegExp(`\\b${MODE_STAMP[key].en}\\b`, 'i').test(content) || MODE_STAMP[key].ar.test(content)) return key;
  }
  return null;
}

function NoticeChip({ kind, content }: { kind?: string; content: string }) {
  const t = useT();
  const meta = NOTICE_META[kind ?? 'sys'] ?? NOTICE_META.sys;
  const isProgress = (kind ?? '') === 'progress';
  const modeKey = (kind ?? '') === 'mode' ? taskModeOf(content) : null;
  const modeStamp = modeKey ? MODE_STAMP[modeKey] : null;
  // Checkpoint notices (and gate notices that mention one) get their own
  // bookmarked-plate mark — the same stamp grammar as the four task modes.
  const isCheckpoint = (kind ?? '') === 'checkpoint' || ((kind ?? '') === 'gate' && /checkpoint/i.test(content));
  const stampKind: StampKey | null = modeKey ?? (isCheckpoint ? 'checkpoint' : null);
  const stampWord = modeStamp ? modeStamp.en : isCheckpoint ? 'CHECKPOINT' : '';
  const stampColor = modeStamp?.color ?? 'var(--v-read)';
  const isContinuity = CONTINUITY_KINDS.has(kind ?? '');
  // v12 — the ONE 20s thinking marker is a quiet mono line, not a chip/box.
  // Its content is "\n[thinking Ns — still reasoning…]"; drop the wrapper
  // brackets so the line reads plainly while the dot carries liveness.
  const isQuietMarker = (kind ?? '') === 'thinking';
  // strip the bracket tag — the chip label already says what this is; when
  // the tag WAS the whole text (e.g. "[verify passed]") keep the original
  const flat = (content ?? '').replace(/\n+/g, ' ').trim();
  const body = isQuietMarker
    ? flat.replace(/^\[/, '').replace(/\]$/, '').trim()
    : (content ?? '').replace(/^\s*\[[^\]]*\]\s*/, '').replace(/\n+/g, ' ').trim() || flat;
  return (
    <div
      className={`sc-notice anim-in msg-in ${isProgress ? 'sc-notice-progress' : ''} ${
        stampKind ? 'sc-notice-mode' : ''
      } ${isContinuity ? 'sc-continuity' : ''} ${isQuietMarker ? 'sc-notice-quiet' : ''}`}
      dir="auto"
      data-notice={kind ?? 'sys'}
      style={stampKind ? ({ '--mode-c': stampColor } as React.CSSProperties) : undefined}
    >
      {isContinuity && <span className="sc-continuity-mark" aria-hidden />}
      {isQuietMarker && <span className="sc-notice-live-dot" aria-hidden />}
      {stampKind ? (
        <MonogramStamp kind={stampKind} word={stampWord} color={stampColor} />
      ) : (
        <span className="sc-notice-tag">{t(`mv.notice.${kind ?? 'sys'}`, meta.en)}</span>
      )}
      <span className="sc-notice-body">{body || meta.en}</span>
    </div>
  );
}

// ---------------- v11.9 smooth token streaming (founder #4) ----------------
// Deltas arrive in bursts (network + engine batching); rendering them raw
// makes the transcript freeze then suddenly pop. useSmoothStream drains a
// display buffer at animation-frame rate so text grows CONTINUOUSLY.
// Presentation only — the store/engine contract is untouched: when streaming
// ends (or the source shrinks on session switch) it snaps to the real text.
// v11.11 (wave2-A1) — the drain math moved to src/lib/streamDisplay.ts
// (unit-tested): 35%/frame of the remaining deficit with TIME-BASED
// smoothing (frame-rate independent), a 3-char floor, and near-instant
// catch-up past an 80-char backlog — the 20ms engine batches land with
// imperceptible lag and never freeze-then-pop (founder #2).

function useSmoothStream(source: string, enabled: boolean): string {
  const [shown, setShown] = useState(() => (enabled ? '' : source));
  // v13 — the animation loop reads the LATEST source from a ref and drives
  // itself via a self-perpetuating rAF. It does NOT depend on `shown`, so a
  // frame's setShown no longer tears down + recreates the loop (the old
  // [source, enabled, shown] deps restarted rAF every frame — a jank source).
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const lenRef = useRef(enabled ? 0 : source.length);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);

  // v11.24 (LATENCY) — the FIRST delta paints in THIS commit, not one frame
  // later. A render-phase state update on the SAME component is re-rendered by
  // React immediately before commit, so the first token is visible with zero
  // rAF/timer on its critical path. The first engine flush is tiny (batched),
  // so showing it verbatim is honest; every later delta still drains smoothly.
  if (enabled && source.length > 0 && shown.length === 0 && lenRef.current === 0) {
    lenRef.current = source.length;
    setShown(source);
  }

  useEffect(() => {
    if (!enabled) {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      lastFrameRef.current = 0;
      lenRef.current = sourceRef.current.length;
      setShown(sourceRef.current);
      return;
    }
    // source shrank (session switch / regenerate) → snap back.
    if (source.length < lenRef.current) {
      lenRef.current = source.length;
      lastFrameRef.current = 0;
      setShown(source);
      return;
    }
    const tick = (ts?: number) => {
      rafRef.current = null;
      const src = sourceRef.current;
      const target = src.length;
      const deficit = target - lenRef.current;
      if (deficit <= 0) return; // loop ends naturally; restarts on next source change
      const t = typeof ts === 'number' ? ts : performance.now();
      const frameMs = lastFrameRef.current > 0 ? Math.max(4, t - lastFrameRef.current) : 1000 / 60;
      lastFrameRef.current = t;
      lenRef.current = Math.min(target, lenRef.current + drainStepChars(deficit, frameMs));
      setShown(src.slice(0, Math.floor(lenRef.current)));
      rafRef.current = requestAnimationFrame(tick); // keep draining until caught up
    };
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick);
  }, [source, enabled]); // stable — no `shown` dependency

  useEffect(() => () => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }, []);

  return shown;
}

/**
 * Inline reasoning rail — premium & calm (replaces the old "gray Thought-for
 * box"): one hairline rail + a small, subtly animated node, the engine's
 * think_delta revealed word-by-word while it streams, then a soft collapse
 * to a single quiet line. No fill card, no gradient, no glow.
 * · live while streaming → BARE streaming text (no card — chat.css),
 *   EXPANDED by default, live seconds ticker, rAF-smoothed growth;
 * · the node shows ONLY while no reasoning text has landed yet — once text
 *   flows the stream itself is the indicator (founder #3);
 * · when the run moves on (answer text starts, or turn ends) → auto-collapses
 *   to a one-liner "Thought for Ns" (ticker measures THINKING only — the
 *   engine-persisted thinkMs is preferred, client-measured ms as fallback);
 * · user toggle pins the open state against auto-collapse;
 * · collapsed state keeps a faint first-line peek.
 */
// v11.24 — the keyed word-reveal shimmer is deleted. Reasoning renders as ONE
// stable text node per line; no per-word spans, no CSS shimmer, no re-keyed
// node tree on every think_delta. The precision circle is the only motion.

/**
 * v11.26 — THE REASONING-HEAD INSTRUMENT: enlarged, box-free and MEASURED.
 *
 * The founder: "الدائرة اللي جنب الريثينك والريزونينج صغيرة، كبرها، اجعلها
 *  نفس حجم التي عند الثوت... ما بدك كل إشي جوا مربع/jا إطار — ابدع بالتصميم."
 *
 * ONE instrument, no frame. It is the same craft grammar as the THINK-band
 * circle (StreamTimeline's ThinkOrbit), scaled up to 30px — nearly 2× the
 * band's 16px, so the reasoning rail reads as the more deliberate surface:
 *
 *   • 32-unit integer grid, centre (16,16), rendered at 30px; every radius is
 *     an INTEGER and every stroke is exactly 1px currentColor (var(--acc)).
 *   • concentric r14 / r10 / r6 rings — an opacity-only breath on the two
 *     outer ones (integer radii; no fractional drift, no layout motion).
 *   • a dashed 1px ORBIT TRACE on the exact r12 node path — the quiet groove
 *     the measured node rides, so the motion reads as calibration not decor.
 *   • four MEASURED TICK MARKS at the cardinal angles (integer coordinates
 *     crossing the r14 ring) — top / right / bottom / left, one hairline path.
 *   • a true 12-o'clock registration tick (M16 8v4) crossing the inner ring,
 *     plus the 6-unit calibration arc dashed at true top on that inner ring.
 *   • an equal-angle orbiting node at r12 (ring r2 + solid core r1), native
 *     SMIL rotation about (16,16), parked at 12 o'clock when motion is off.
 *   • NO blur / gradient / glow / filter / fill card — pure token strokes.
 *
 * It animates ONLY while this block is live AND motion is allowed; a settled
 * block, `prefers-reduced-motion: reduce` OR the in-app `html.reduce-motion`
 * switch gives the frozen end state with zero SMIL elements.
 */
/** The single source of truth for the reasoning-head circle's rendered size. */
const REASON_ORBIT_SIZE = 30;

function PrecisionThinkingOrbit({ live }: { live: boolean }) {
  const reduced = usePrefersReducedMotion();
  const animate = live && !reduced;
  return (
    <svg
      className="sc-think-engrave sc-reason-orbit-svg"
      width={REASON_ORBIT_SIZE}
      height={REASON_ORBIT_SIZE}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      focusable="false"
      aria-hidden="true"
      style={{
        display: 'block', position: 'relative', inset: 'auto',
        width: REASON_ORBIT_SIZE, height: REASON_ORBIT_SIZE,
        color: 'var(--acc)',
      }}
    >
      {/* concentric rings — integer radii, 1px strokes, opacity-only breath */}
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1" opacity="0.3">
        {animate && <animate attributeName="r" values="14;15;14" dur="2.8s" repeatCount="indefinite" />}
      </circle>
      <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1" opacity="0.5">
        {animate && <animate attributeName="r" values="10;11;10" dur="2.4s" repeatCount="indefinite" />}
      </circle>
      <circle cx="16" cy="16" r="6" stroke="currentColor" strokeWidth="1" opacity="0.62" />
      {/* orbit trace — a dashed 1px groove on the exact r12 node path. Static:
          the node rotates over a fixed measurement, never a trembling arc. */}
      <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="1" strokeDasharray="1 3" opacity="0.2" />
      {/* measured cardinal ticks — integer coords crossing the r14 ring;
          symmetric about (16,16): top/bottom y1..4 / y28..31, sides x1..4 / x28..31 */}
      <path d="M16 1v3M28 16h3M16 28v3M1 16h3" stroke="currentColor" strokeWidth="1" opacity="0.32" />
      {/* calibration arc — 6-unit dash at true top (rotate -90 about centre) */}
      <circle
        cx="16" cy="16" r="6" stroke="currentColor" strokeWidth="1"
        strokeDasharray="6 100" transform="rotate(-90 16 16)" opacity="0.4"
      />
      {/* 12-o'clock registration tick — crosses the inner ring top (y=10) */}
      <path d="M16 8v4" stroke="currentColor" strokeWidth="1" opacity="0.55" />
      {/* orbiting node — r12 from centre, equal-angle rotation, ring r2 + core r1 */}
      <g>
        {animate && (
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 16 16"
            to="360 16 16"
            dur="2.2s"
            repeatCount="indefinite"
          />
        )}
        <circle cx="16" cy="4" r="2" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <circle cx="16" cy="4" r="1" fill="currentColor" />
      </g>
    </svg>
  );
}

// memo — a settled reasoning block must NOT re-parse when the answer stream
// (or any unrelated store tick) re-renders its parent row (wave2-A1 rule 3).
const ThinkingBlock = memo(function ThinkingBlock({
  text,
  active,
  answerStarted = false,
  thinkMs,
}: {
  text: string;
  active: boolean;
  /** D1 — the answer stream has begun: the block settles to the "Thought for
   *  Ns" row even though the TURN is still streaming, so the seconds ticker
   *  measures THINKING only — never the whole turn. */
  answerStarted?: boolean;
  /** D2 — authoritative thinking duration (ms) the engine persists on
   *  message_end; preferred over the client-measured fallback when present
   *  (old sessions without thinkMs keep the client-measured value). */
  thinkMs?: number;
}) {
  // D1 — live = streaming reasoning AND no answer text yet. Once the answer
  // streams, the block shows the settled "Thought for Ns" row (collapsed
  // unless the user pinned it open) instead of ticking for the whole turn.
  const live = active && !answerStarted;
  const t = useT();
  const [open, setOpen] = useState(live); // live blocks start expanded
  const [pinned, setPinned] = useState(false); // user override wins over automation
  const [copiedThink, setCopiedThink] = useState(false); // v11.2 copy-reasoning chip
  const [liveSecs, setLiveSecs] = useState(0);
  const startedAt = useRef<number | null>(live ? Date.now() : null);
  const [doneSecs, setDoneSecs] = useState<number | null>(null);
  // — v11.9 stream presentation: the reasoning drains through useSmoothStream
  // so it grows continuously (no chunk-jumps); settled prose recedes into
  // ghosted ink, the live tail carries --think-ink, and a 6px pulsing dot
  // marks the write head — never a block caret. Auto-scroll pins to the tail
  // and releases the moment the user scrolls up (a "jump to live" chip).
  const shown = useSmoothStream(text, live);
  // v11.24 — no per-delta word counting: the waveform, beads and keyed word
  // spans are gone. The smoothed text below is plain, stable text; the only
  // motion left in this block is the single precision circle in its head.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const tailPinnedRef = useRef(true);
  const [tailPinned, setTailPinned] = useState(true);
  const onBodyScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const atTail = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
    if (atTail !== tailPinnedRef.current) {
      tailPinnedRef.current = atTail;
      setTailPinned(atTail);
    }
  };
  useEffect(() => {
    if (!open || !live || !tailPinnedRef.current) return;
    const raf = requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [shown, open, live]);

  useEffect(() => {
    if (live) {
      if (startedAt.current === null) startedAt.current = Date.now();
      if (!pinned) setOpen(true);
      const iv = setInterval(() => {
        setLiveSecs(startedAt.current ? Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)) : 0);
      }, 1000);
      return () => clearInterval(iv);
    }
    // run moved on (answer streaming / turn ended) — freeze the client-side
    // duration once, auto-collapse
    if (startedAt.current !== null && doneSecs === null) {
      setDoneSecs(Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)));
    }
    if (!pinned) setOpen(false);
    return undefined;
  }, [live, pinned, doneSecs]);

  // two-tone split (on the SMOOTHED text): everything before the final
  // newline is settled ink-dim; the trailing fragment is the live write head.
  let settled = '';
  let tail = '';
  if (shown) {
    const cut = shown.lastIndexOf('\n');
    if (cut >= 0 && cut >= shown.length - 1) {
      settled = shown.slice(0, cut);
    } else if (cut >= 0) {
      settled = shown.slice(0, cut + 1);
      tail = shown.slice(cut + 1);
    } else {
      tail = shown;
    }
  }

  const jumpToLive = () => {
    tailPinnedRef.current = true;
    setTailPinned(true);
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // v11.8 — the collapsed one-liner carries a faint first-line peek so a
  // settled block is recognizable at a glance without expanding it.
  const peek = useMemo(() => text.replace(/\s+/g, ' ').trim().slice(0, 120), [text]);
  // D2 — the settled label prefers the engine-persisted duration (thinkMs);
  // the client-measured value is the fallback for sessions without it.
  const settledSecs =
    typeof thinkMs === 'number' && thinkMs > 0 ? Math.max(1, Math.round(thinkMs / 1000)) : doneSecs;
  const peekLabel = settledSecs !== null
    ? t('chat.thinking.thoughtFor', 'Thought for {s}s', { s: settledSecs })
    : t('chat.thinking', 'Thinking');

  return (
    <div className={`kb-think reason-rail ${live ? 'is-active' : ''} ${open ? 'open' : ''}`}>
      <button
        className="kb-think-head"
        /* v11.26 — positioning context for the floating 1px baseline below. */
        style={{ position: 'relative' }}
        onClick={() => {
          setPinned(true);
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        title={open ? t('chat.thinking.hide', 'Hide reasoning') : t('chat.thinking.show', 'Show reasoning')}
      >
        {/* v11.22 — the founder's spinning circle replaces the old app-logo +
            descending-line glyph here. No brand logo, no engraving sweep, no
            "زبط": just the precision orbit, live-only motion. The class names
            stay (asserted hooks); only the SVG children changed. */}
        <span
          className={`sc-reason-glyph sc-think-mark sc-reason-orbit-slot shrink-0 ${live ? 'is-live' : ''}`}
          /* v11.26 — BOX KILLED IN JSX. The reasoning circle floats free: no
             border, background, radius or shadow may wrap it. Any remaining
             square comes from CSS we do not own (console.css §5, the
             .sc-reason-glyph 15px/4px plate + its ::after frame) — reported to
             the parent. chat-art.css already suppresses that pseudo with
             `sc-think-mark::after { content:none!important }`. */
          style={{
            width: REASON_ORBIT_SIZE,
            height: REASON_ORBIT_SIZE,
            color: 'var(--acc)',
            border: 'none',
            background: 'none',
            borderRadius: 0,
            boxShadow: 'none',
            display: 'inline-flex',
            flex: '0 0 auto',
          }}
          aria-hidden
        >
          <PrecisionThinkingOrbit live={live} />
        </span>
        {live ? (
          <>
            <span className="flex-1 min-w-0 truncate kb-think-live-label">
              {t('chat.thinking', 'Thinking')}
            </span>
            {liveSecs > 0 && (
              <span className="sc-think-clock tnum shrink-0" dir="ltr">
                <span className="sc-think-clock-label">T+</span>
                {fmtThinkElapsed(liveSecs)}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="kb-think-label shrink-0">{peekLabel}</span>
            {!open && peek && <span className="sc18-think-peek">{peek}</span>}
          </>
        )}
        <ChevronDown size={12} className="kb-think-caret shrink-0" />
        {/* v11.26 — a fine, STATIC 1px baseline under the reasoning header.
            Starts at the instrument's trailing edge (30 + 8px gap) so it
            measures the label instead of boxing it. Token colour, no fill,
            no glow, no gradient, no layout motion — nothing to disable. */}
        <span
          className="sc-reason-baseline"
          aria-hidden="true"
          style={{
            position: 'absolute',
            insetInlineStart: 38,
            insetInlineEnd: 0,
            bottom: 0,
            height: 1,
            background: 'var(--line-soft)',
            opacity: 0.6,
            pointerEvents: 'none',
          }}
        />
      </button>
      {/* v11.2 — copy the reasoning verbatim (settled blocks only; live stream is still growing) */}
      {!live && (
        <button
          className="kb-think-copy"
          type="button"
          title={copiedThink ? t('chat.thinking.copied', 'Copied') : t('chat.thinking.copy', 'Copy reasoning')}
          aria-label={t('chat.thinking.copy', 'Copy reasoning')}
          onClick={(e) => {
            e.stopPropagation();
            const done = () => {
              setCopiedThink(true);
              window.setTimeout(() => setCopiedThink(false), 1400);
            };
            if (navigator.clipboard?.writeText) {
              navigator.clipboard.writeText(text).then(done).catch(() => {});
            } else done();
          }}
        >
          {copiedThink ? <Check size={11} /> : <Copy size={11} />}
        </button>
      )}
      {open && (
        <div className="kb-think-body" dir="auto" ref={bodyRef} onScroll={onBodyScroll}>
          {settled && <span className="kb-think-settled">{settled}</span>}
          <span className="kb-think-tail">
            {tail}
          </span>
        </div>
      )}
      {open && live && !tailPinned && (
        <button className="kb-think-jump" type="button" onClick={jumpToLive}>
          {t('chat.thinking.live', 'Jump to live')}
          <ChevronDown size={11} />
        </button>
      )}
    </div>
  );
});

// ---------------- code block with language chip + copy ----------------
// v2.6: code is ALWAYS LTR (direction + unicode-bidi isolate on the whole
// block) — Arabic comments inside code must never scramble. The head keeps
// a fixed LTR internal layout so the lang chip and the copy button can
// never collide (they did in RTL before kb-code had any styles).
function CodeBlock({ lang, code, children }: { lang: string; code: string; children: React.ReactNode }) {
  const t = useT();
  const { copied, copy } = useCopyFeedback();
  return (
    <div className="kb-code code-ltr" dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'isolate' }}>
      <div className="kb-code-head">
        <span className="kb-code-lang">{lang || 'text'}</span>
        <button
          className="kb-code-copy"
          onClick={() => {
            void copy(code);
          }}
          title={t('chat.copy', 'Copy')}
          aria-label={t('chat.copy', 'Copy')}
        >
          {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function CodeBlockShell({ node, children }: { node?: HastNode; children?: React.ReactNode }) {
  const child = Array.isArray(children) ? children[0] : children;
  let lang = '';
  if (React.isValidElement(child)) {
    const cls = (child.props as { className?: string }).className ?? '';
    lang = /language-([\w+#.-]+)/.exec(cls)?.[1] ?? '';
  }
  return (
    <CodeBlock lang={lang} code={hastText(node)}>
      {children}
    </CodeBlock>
  );
}

/** Streaming code shell — same .kb-code frame + lang chip, but NO copy button
 *  and NO hastText whole-tree walk (the copy text would cost O(tree) per
 *  delta). The full CodeBlockShell renders once on message_end. */
function StreamingCodeShell({ children }: { children?: React.ReactNode }) {
  const child = Array.isArray(children) ? children[0] : children;
  let lang = '';
  if (React.isValidElement(child)) {
    const cls = (child.props as { className?: string }).className ?? '';
    lang = /language-([\w+#.-]+)/.exec(cls)?.[1] ?? '';
  }
  return (
    <div className="kb-code code-ltr" dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'isolate' }}>
      <div className="kb-code-head">
        <span className="kb-code-lang">{lang || 'text'}</span>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

// Stable across renders so ReactMarkdown never rebuilds its pipeline.
// v2.6 bidi contract — the ROOT dir="auto" is NOT enough: a message that
// starts with English/code resolves the whole container LTR and every
// Arabic paragraph inside it scrambles (colons jump, numbers misplace).
// Fix (W3C pattern): EVERY block-level element gets dir="auto" +
// unicode-bidi:plaintext + text-align:start, so each paragraph takes its
// own first-strong base direction. Code/pre stay hard-LTR (isolated).
const BIDI_BLOCK = { dir: 'auto', style: { unicodeBidi: 'plaintext', textAlign: 'start' } } as const;
// v11.24 (latency) — hoisted, frozen plugin arrays. The old inline `[remarkGfm]`
// / `[rehypeHighlight]` literals were rebuilt on EVERY delta, forcing the
// markdown pipeline to re-initialise its micromark extensions each frame.
const MD_REMARK_PLUGINS: NonNullable<Parameters<typeof ReactMarkdown>[0]['remarkPlugins']> = [remarkGfm];
const MD_REHYPE_PLUGINS: NonNullable<Parameters<typeof ReactMarkdown>[0]['rehypePlugins']> = [rehypeHighlight];
const MD_COMPONENTS: Components = {
  a: ({ node, ...rest }) => <a {...rest} target="_blank" rel="noreferrer" />,
  pre: ({ node, children }) => (
    <CodeBlockShell node={node as HastNode | undefined}>{children}</CodeBlockShell>
  ),
  p: ({ node, ...rest }) => <p {...rest} {...BIDI_BLOCK} />,
  li: ({ node, ...rest }) => <li {...rest} {...BIDI_BLOCK} />,
  h1: ({ node, ...rest }) => <h1 {...rest} {...BIDI_BLOCK} />,
  h2: ({ node, ...rest }) => <h2 {...rest} {...BIDI_BLOCK} />,
  h3: ({ node, ...rest }) => <h3 {...rest} {...BIDI_BLOCK} />,
  h4: ({ node, ...rest }) => <h4 {...rest} {...BIDI_BLOCK} />,
  blockquote: ({ node, ...rest }) => <blockquote {...rest} {...BIDI_BLOCK} />,
  td: ({ node, ...rest }) => <td {...rest} {...BIDI_BLOCK} />,
  th: ({ node, ...rest }) => <th {...rest} {...BIDI_BLOCK} />,
  code: ({ node, ...rest }) => <code {...rest} style={{ unicodeBidi: 'isolate', direction: 'ltr' }} />,
};

/** Streaming variant — identical bidi contract, but plain <pre><code> blocks
 *  (no highlight.js pipeline, no copy button / hastText walk). Still fenced,
 *  still GFM. Module-level const so ReactMarkdown's pipeline stays stable. */
const MD_COMPONENTS_LIVE: Components = {
  a: ({ node, ...rest }) => <a {...rest} target="_blank" rel="noreferrer" />,
  pre: ({ children }) => <StreamingCodeShell>{children}</StreamingCodeShell>,
  // First paragraph only: a one-shot "ink spreading" reveal when the answer
  // begins (art-ink-spread). React reuses this DOM node while text streams,
  // so the animation plays ONCE — no per-delta shimmer, no jitter.
  p: ({ node, ...rest }) => {
    const first = ((node as HastNode | undefined)?.position?.start?.line ?? 99) <= 2;
    return <p {...rest} {...BIDI_BLOCK} className={first ? 'md-first-ink' : undefined} />;
  },
  li: ({ node, ...rest }) => <li {...rest} {...BIDI_BLOCK} />,
  h1: ({ node, ...rest }) => <h1 {...rest} {...BIDI_BLOCK} />,
  h2: ({ node, ...rest }) => <h2 {...rest} {...BIDI_BLOCK} />,
  h3: ({ node, ...rest }) => <h3 {...rest} {...BIDI_BLOCK} />,
  h4: ({ node, ...rest }) => <h4 {...rest} {...BIDI_BLOCK} />,
  blockquote: ({ node, ...rest }) => <blockquote {...rest} {...BIDI_BLOCK} />,
  td: ({ node, ...rest }) => <td {...rest} {...BIDI_BLOCK} />,
  th: ({ node, ...rest }) => <th {...rest} {...BIDI_BLOCK} />,
  code: ({ node, ...rest }) => <code {...rest} style={{ unicodeBidi: 'isolate', direction: 'ltr' }} />,
};

/**
 * Streaming-only fence balancing: an odd count of line-start fences means
 * the closing ``` hasn't streamed yet — append it so the in-progress code
 * block renders as a block immediately instead of flashing as plain text.
 */
function balanceFences(s: string): string {
  const re = /^[ \t]{0,3}```/gm;
  let n = 0;
  while (re.exec(s)) n++;
  return n % 2 === 1 ? `${s}\n\u0060\u0060\u0060` : s;
}

/**
 * v12 — markdown size cap. A settled message larger than this renders a
 * truncated preview with a "show full" expander instead of forcing the
 * GFM + highlight pipeline to parse an enormous document (a common cause
 * of a frozen transcript after a huge tool dump). Streaming text is never
 * capped. The message content itself is NEVER altered — only rendering.
 */
const MD_RENDER_CAP = 120_000;

// memo — settled markdown segments never re-parse when the parent row
// re-renders per flush; the LIVE segment re-parses only when its own text
// changes (wave2-A1 rule 3: no full-list re-render per flush).
const Markdown = memo(function Markdown({ text, cursor, streaming }: {
  text: string;
  cursor?: boolean;
  streaming?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  // v11.9 — while this is the live tail (cursor=true) the text drains through
  // useSmoothStream at animation-frame rate: it grows continuously instead of
  // chunk-jumping (founder #4). Settled text renders verbatim.
  const shown = useSmoothStream(text, !!cursor);
  // v11.24 — no per-delta word count, no nib. Plain stable markdown text.
  const tooBig = !cursor && text.length > MD_RENDER_CAP;
  const fullBody = cursor ? balanceFences(shown) : text;
  const body = tooBig && !expanded ? fullBody.slice(0, MD_RENDER_CAP) : fullBody;
  return (
    <>
      {/* v11.8 — no text-[12.5px]: the reading surface inherits soft.css's
          generous 14.5px/1.7 transcript type. */}
      <div className={`md msg-body ${cursor ? 'streaming-cursor md-live md-writehead' : ''}`} dir="auto">
        {/* ACTIVE streaming: skip rehype-highlight + the copy-button tree walk
            (the O(n) per-delta tax) — the full pipeline renders once at end.
            v11.24 — stable plugin arrays (hoisted) so a delta never rebuilds
            the micromark extension set; no per-delta word/spark work. */}
        <ReactMarkdown
          remarkPlugins={MD_REMARK_PLUGINS}
          rehypePlugins={streaming ? undefined : MD_REHYPE_PLUGINS}
          components={streaming ? MD_COMPONENTS_LIVE : MD_COMPONENTS}
        >
          {body}
        </ReactMarkdown>
      </div>
      {tooBig && (
        <button
          type="button"
          className="md-cap-expander text-[10.5px] mt-1 px-2 py-1 rounded-md transition-colors cursor-pointer"
          style={{ background: 'var(--bg3)', color: 'var(--dim)' }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? t('md.collapseFull', 'Show less')
            : t('md.showFull', 'Show full message') + ` · ${Math.round(text.length / 1000)}k chars`}
        </button>
      )}
    </>
  );
});

/**
 * v11.11 (wave2-A1, rule 5) — the terse completion row, Codex-style: ONE
 * quiet line — `✓ 3.2s · 1234 in · 567 out · $0.004` — when a message
 * settles. Replaces the old two-chip usage row; no confetti, no box.
 * Duration is client-measured when this row lived through its own stream,
 * falling back to the engine-persisted thinkMs; tokens render only when
 * the engine reported usage (≈ marker keeps the honesty contract).
 */
function DoneRow({ msg }: { msg: ChatMessage }) {
  const t = useT();
  const thinkMs = (msg as ChatMessageWithThinkMs).thinkMs;
  const startedRef = useRef<number | null>(msg.streaming ? Date.now() : null);
  const [durMs, setDurMs] = useState<number | null>(null);
  useEffect(() => {
    if (!msg.streaming && startedRef.current !== null) {
      setDurMs(Math.max(0, Date.now() - startedRef.current));
      startedRef.current = null;
    }
  }, [msg.streaming]);
  if (msg.streaming) return null;
  const usage = msg.usage;
  const dur =
    durMs !== null && durMs >= 400
      ? formatDoneDuration(durMs)
      : typeof thinkMs === 'number' && thinkMs > 0
        ? formatDoneDuration(thinkMs)
        : null;
  if (!usage && dur === null) return null;
  return (
    <div className="sc-done-row" dir="ltr">
      <Check size={11} className="sc-done-check shrink-0" aria-hidden />
      {dur !== null && <span className="tnum">{dur}</span>}
      {usage && (
        <span className="tnum">
          {t('chat.tokens', '{in} in · {out} out')
            .replace('{in}', `${usage.estimated ? '≈' : ''}${usage.inputTokens}`)
            .replace('{out}', String(usage.outputTokens))}
        </span>
      )}
      {usage && <span className="tnum">{fmtCost(usage.costUsd)}</span>}
    </div>
  );
}

// ---------------- hover action bar ----------------
//
// Copy · Retry (existing) + the v2.2 DNA feedback thumbs. Behavior contract:
//   • click thumbs up/down → the inline note row opens for that kind (switching kinds
//     keeps the typed note — the draft belongs to the MESSAGE, not the thumb);
//     the bar stays pinned open while the row is active (see dna.css).
//   • Enter submits (IME-composition safe), Escape cancels and closes without
//     recording, blur never submits (no blur handler by design).
//   • a submit only counts once api.dnaFeedback resolves {ok:true}: the thumb
//     then keeps a PERSISTENT tint (not just hover), a 'Copied'-style
//     "Recorded" stamp flashes and the row collapses. {ok:false} (backend
//     same-note 1h dedupe) or an IPC error keeps the row + draft open and
//     shows the failure toast — never a false success.
//   • at most ONE record per message: while composing, the other thumb simply
//     replaces the pending choice; once recorded, the opposite thumb is
//     disabled and re-clicking the SAME thumb is a no-op that closes the row
//     (electron/agent/dna.ts has no per-entry removal API, so a true undo is
//     impossible from the UI — a later, different record still supersedes the
//     old one in the prompt, which reads feedback newest-first).
//   • the recorded choice is re-hydrated from the persisted DNA model (its
//     `context` is the first 120 chars of this message) so a past rating
//     shows as active instead of looking lost.
//   • a tiny .dna-fb-flag chip stays visible whenever the hover-only bar is
//     hidden, so a recorded rating remains discoverable.
function RowActions({
  onCopy,
  onRetry,
  copied,
  feedbackContext,
  model,
  time,
}: {
  onCopy: () => void;
  onRetry?: () => void;
  copied: boolean;
  /** First 120 chars of the assistant message — enables the DNA thumbs. */
  feedbackContext?: string;
  /** v11.8 — model id + timestamp live in the hover bar on every row (the
   *  static header shows them only on the first row of a turn group). */
  model?: string;
  time?: string;
}) {
  const t = useT();
  const ar = useStore((s) => s.settings?.language === 'ar');
  // Which thumb's note row is open (the pending choice) — null = closed.
  const [mode, setMode] = useState<'praise' | 'correction' | null>(null);
  // The ONE confirmed record for this message — set only on {ok:true}.
  const [recorded, setRecorded] = useState<'praise' | 'correction' | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  // 'Copied'-style flash: brief "Recorded" confirmation with timer cleanup.
  const [justRecorded, setJustRecorded] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (mode) inputRef.current?.focus();
  }, [mode]);

  // Re-hydrate a past rating: the persisted model stores the first 120 chars
  // of the message as `context` — an exact match restores the active thumb so
  // the UI reflects what was actually recorded (runs once, read-only).
  const [hydrated, setHydrated] = useState(false);
  const dnaFeedbackList = useStore((s) => s.dna?.feedback);
  useEffect(() => {
    if (hydrated || !feedbackContext || !dnaFeedbackList) return; // DNA not loaded yet — retry on next load
    const hit = dnaFeedbackList.find((f) => f.context === feedbackContext);
    setRecorded(hit && (hit.kind === 'praise' || hit.kind === 'correction') ? hit.kind : null);
    setHydrated(true);
  }, [hydrated, feedbackContext, dnaFeedbackList]);

  const send = (kind: 'praise' | 'correction') => {
    if (sending) return; // double-Enter guard while a record is in flight
    const st = useStore.getState();
    const fallback = t(
      kind === 'praise' ? 'dna.fb.defaultPraise' : 'dna.fb.defaultCorrection',
      kind === 'praise' ? 'Good answer — keep this approach' : 'Off track — adjust future answers',
    );
    // Embed a message excerpt in the fallback note: recordFeedback dedupes the
    // exact same note text within an hour (context is NOT part of the key), so
    // the old static default made the second praised message silently record
    // nothing while the UI claimed success. A per-message excerpt keeps notes
    // unique AND tells the model which answer it applies to.
    const text = note.trim() || (feedbackContext ? `${fallback} — "${trunc(feedbackContext, 60)}"` : fallback);
    setSending(true);
    api
      .dnaFeedback(kind, text, feedbackContext)
      .then((res) => {
        if (res && res.ok) {
          setRecorded(kind); // this message's single record — replaces any pending choice
          setJustRecorded(true); // 'Copied'-style confirmation flash
          if (confirmTimer.current) clearTimeout(confirmTimer.current);
          confirmTimer.current = setTimeout(() => setJustRecorded(false), 1600);
          setMode(null); // collapse the note row after the confirmation
          setNote('');
          st.notify(t('dna.fb.sent', 'DNA updated — SADEEM adapts to your feedback'));
        } else {
          // {ok:false} — backend rejected it (empty note / same-note dedupe):
          // keep the row + draft open so the user can reword. No false success.
          st.notify(t('dna.fb.failed', 'Could not record the feedback'));
        }
      })
      .catch(() => st.notify(t('dna.fb.failed', 'Could not record the feedback')))
      .finally(() => setSending(false));
  };

  const toggleThumb = (kind: 'praise' | 'correction') => {
    if (recorded === kind) {
      // Already recorded — dna.ts has no per-entry removal API, so a second
      // click cannot undo anything; make it a clean no-op that closes the row.
      setMode(null);
      return;
    }
    setMode((m) => (m === kind ? null : kind)); // keep the typed note across kinds
  };

  return (
    <>
      <div className={`kb-row-actions ${mode || justRecorded ? 'is-open' : ''}`}>
        <button onClick={onCopy} title={t('chat.copy', 'Copy')} aria-label={t('chat.copy', 'Copy')}>
          {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
          <span>{copied ? t('chat.copied', 'Copied') : t('chat.copy', 'Copy')}</span>
        </button>
        {onRetry && (
          <button onClick={onRetry} title={t('chat.retry', 'Retry')} aria-label={t('chat.retry', 'Retry')}>
            <RotateCcw size={11} />
            <span>{t('chat.retry', 'Retry')}</span>
          </button>
        )}
        {feedbackContext !== undefined && (
          <>
            <button
              onClick={() => toggleThumb('praise')}
              disabled={sending || recorded === 'correction'}
              className={mode === 'praise' ? 'text-ok' : recorded === 'praise' ? 'is-fb-active' : ''}
              title={t('dna.fb.up', 'Helpful — teach SADEEM to keep this')}
              aria-label={t('dna.fb.up', 'Helpful — teach SADEEM to keep this')}
              aria-pressed={mode === 'praise' || recorded === 'praise'}
            >
              <ThumbsUp size={11} />
            </button>
            <button
              onClick={() => toggleThumb('correction')}
              disabled={sending || recorded === 'praise'}
              className={mode === 'correction' ? 'text-warn' : recorded === 'correction' ? 'is-fb-active is-fb-down' : ''}
              title={t('dna.fb.down', 'Not helpful — tell SADEEM what to change')}
              aria-label={t('dna.fb.down', 'Not helpful — tell SADEEM what to change')}
              aria-pressed={mode === 'correction' || recorded === 'correction'}
            >
              <ThumbsDown size={11} />
            </button>
            {justRecorded && recorded && (
              <span className={`dna-fb-stamp ${recorded === 'correction' ? 'is-down' : 'is-up'}`} role="status">
                <Check size={11} />
                <span>{t('dna.fb.recorded', ar ? 'سُجّل' : 'Recorded')}</span>
              </span>
            )}
            {mode && (
              <span className="dna-note">
                <input
                  ref={inputRef}
                  value={note}
                  disabled={sending}
                  dir="auto"
                  spellCheck={false}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return; // IME composition — not a submit
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      send(mode);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setMode(null); // cancel: close without recording
                      setNote('');
                    }
                  }}
                  placeholder={t('dna.fb.notePh', 'Optional note — what should SADEEM adjust?')}
                  aria-label={t('dna.fb.notePh', 'Optional note — what should SADEEM adjust?')}
                />
              </span>
            )}
            {(model || time) && (
              <span className="sc18-act-meta tnum" dir="ltr" title={model ?? ''}>
                {model ? shortModel(model) : ''}
                {model && time ? ' · ' : ''}
                {time ?? ''}
              </span>
            )}
          </>
        )}
      </div>
      {/* Persistent "rated" flag — the bar itself is hover-revealed, so once a
          record exists this tiny thumb chip stays visible whenever the bar is
          hidden (it fades out while the real bar is shown, and never catches
          clicks). */}
      {feedbackContext !== undefined && recorded && (
        <span
          className={`dna-fb-flag ${recorded === 'correction' ? 'is-down' : 'is-up'}`}
          title={
            recorded === 'praise'
              ? t('dna.fb.up', 'Helpful — teach SADEEM to keep this')
              : t('dna.fb.down', 'Not helpful — tell SADEEM what to change')
          }
        >
          {recorded === 'praise' ? <ThumbsUp size={9} /> : <ThumbsDown size={9} />}
        </span>
      )}
    </>
  );
}

// ---------------- v11.34 — real image results render as IMAGES ---------------
// Founder: "أحيانا لما يلتقط صورة أو يستخدم صورة بتطلع لي على شكل كود... وأرقام،
// ما بتطلع لي كصورة". The engine's tool_result content for EVERY image tool is
// one of these REAL shapes (electron/agent/tools.ts — read-only):
//   • read_image / screenshot / browser_screenshot / preview_screenshot /
//     desktop_control(screenshot) → JSON {ok:true, mime, dataUrl, path?, note?}
//   • image_generate → "Image generated → <path> (WxH, KB, model …)"
//   • tool_result may also carry `images: string[]` (data URLs or file paths).
// ResultRow used to dump that payload verbatim into <pre> — raw base64/JSON.
// We detect ONLY these real shapes and render a real <img>. A failed result, a
// base64 snippet inside prose, or an image path inside an ERROR is never shown
// as an image (LLM-honest: no fabricated / placeholder pictures).

export interface ImageResultItem {
  src: string; // real data URL or real image file path
  filename: string; // real basename from the payload
  width?: number;
  height?: number;
  bytes?: number;
  isPath: boolean;
}

const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,([A-Za-z0-9+/=]+)$/i;
const IMAGE_PATH_RE = /\.(?:png|jpe?g|gif|webp|bmp|avif)$/i;

const basenameOf = (p: string): string =>
  p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'image';

const positiveInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;

interface ImageMeta { path?: string; width?: number; height?: number; bytes?: number }

function dataUrlItem(dataUrl: string, meta: ImageMeta = {}): ImageResultItem | null {
  const m = DATA_IMAGE_RE.exec(dataUrl.trim());
  if (!m) return null; // only a REAL data:image payload becomes a picture
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const b64 = m[2];
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const bytes = Math.floor((b64.length * 3) / 4) - pad; // exact size of the real bytes
  return {
    src: dataUrl,
    filename: meta.path ? basenameOf(meta.path) : `image.${ext}`,
    width: meta.width,
    height: meta.height,
    bytes: meta.bytes ?? (bytes > 0 ? bytes : undefined),
    isPath: false,
  };
}

function pathItem(p: string, meta: ImageMeta = {}): ImageResultItem | null {
  const clean = p.trim().replace(/^file:\/\//i, '').replace(/^['"]|['"]$/g, '');
  if (!IMAGE_PATH_RE.test(clean)) return null; // never fake an image from arbitrary text
  return {
    src: clean,
    filename: basenameOf(clean),
    width: meta.width,
    height: meta.height,
    bytes: meta.bytes,
    isPath: true,
  };
}

function recordOf(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Pure detector — unit-tested by tests/v1134-image-display.test.mjs. */
export function imageItemsOf(content: string | undefined, images?: string[], resultOk = true): ImageResultItem[] {
  const out: ImageResultItem[] = [];
  const seen = new Set<string>();
  const add = (it: ImageResultItem | null) => {
    if (it && !seen.has(it.src)) { seen.add(it.src); out.push(it); }
  };
  // (1) explicit attachments on the tool_result row (real images only)
  if (resultOk && Array.isArray(images)) {
    for (const s of images) {
      // v11.34 — accept BOTH a plain string and an object carrying dataUrl/path
      // (the renderer previously skipped objects → broken <img src="C:\...">).
      if (typeof s === 'string') {
        add(DATA_IMAGE_RE.test(s.trim()) ? dataUrlItem(s) : pathItem(s));
      } else if (s && typeof s === 'object') {
        const obj = s as { dataUrl?: unknown; url?: unknown; path?: unknown };
        const src = typeof obj.dataUrl === 'string' ? obj.dataUrl : typeof obj.url === 'string' ? obj.url : typeof obj.path === 'string' ? obj.path : '';
        if (!src) continue;
        add(DATA_IMAGE_RE.test(src.trim()) ? dataUrlItem(src) : pathItem(src));
      }
    }
  }
  const text = typeof content === 'string' ? content.trim() : '';
  if (!resultOk || !text) return out;

  // (2) the engine's JSON result contract
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const rec = recordOf(JSON.parse(text));
      if (rec && rec.ok === true) {
        const path = typeof rec.path === 'string' ? rec.path : undefined;
        const meta: ImageMeta = {
          path,
          width: positiveInt(rec.width),
          height: positiveInt(rec.height),
          bytes: positiveInt(rec.bytes ?? rec.size),
        };
        if (typeof rec.dataUrl === 'string') add(dataUrlItem(rec.dataUrl, meta));
        if (Array.isArray(rec.images)) {
          for (const s of rec.images) {
            if (typeof s === 'string') {
              add(DATA_IMAGE_RE.test(s.trim()) ? dataUrlItem(s, meta) : pathItem(s, meta));
            } else if (s && typeof s === 'object') {
              const obj = s as { dataUrl?: unknown; url?: unknown; path?: unknown };
              const src = typeof obj.dataUrl === 'string' ? obj.dataUrl : typeof obj.url === 'string' ? obj.url : typeof obj.path === 'string' ? obj.path : '';
              if (src) add(DATA_IMAGE_RE.test(src.trim()) ? dataUrlItem(src, meta) : pathItem(src, meta));
            }
          }
        }
        if (typeof rec.dataUrl !== 'string' && path) add(pathItem(path, meta));
      }
    } catch { /* prose, not a JSON result — fall through */ }
  }

  // (3) image_generate's plain-text success line (real dims + size in the text)
  const gen = /Image generated\s*→\s*(\S+\.(?:png|jpe?g|gif|webp|bmp|avif))\s*(?:\(([^)]*)\))?/i.exec(text);
  if (gen) {
    const detail = gen[2] ?? '';
    const dim = /(\d+)\s*[x×]\s*(\d+)/.exec(detail);
    const kb = /(\d+(?:\.\d+)?)\s*KB\b/i.exec(detail);
    add(pathItem(gen[1], {
      width: dim ? Number(dim[1]) : undefined,
      height: dim ? Number(dim[2]) : undefined,
      bytes: kb ? Math.round(Number(kb[1]) * 1024) : undefined,
    }));
  }
  return out;
}

/** Mono caption — pure DATA (filename · dimensions · size). No EN+AR mix. */
function imageCaption(it: ImageResultItem): string {
  const bits = [it.filename];
  if (it.width && it.height) bits.push(`${it.width}×${it.height}`);
  if (typeof it.bytes === 'number' && it.bytes > 0) {
    bits.push(it.bytes >= 1024 ? `${Math.round(it.bytes / 1024)}KB` : `${it.bytes}B`);
  }
  return bits.join(' · ');
}

/** Thumbnail + click-to-open lightbox. No card fill/padding: only the bitmap
 *  itself carries a 1px hairline. Escape / backdrop / close button all close. */
const ImageResultGallery = memo(function ImageResultGallery({ items }: { items: ImageResultItem[] }) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="sc18-imgres" dir="ltr">
      {items.map((it, i) => (
        <button
          key={`${it.src.slice(0, 96)}:${i}`}
          type="button"
          className="sc18-imgres-item"
          onClick={() => setOpen(i)}
          title={`${t('mv.img.open', 'Open full size')} · ${imageCaption(it)}`}
          aria-label={`${t('mv.img.open', 'Open full size')} · ${imageCaption(it)}`}
        >
          <ImageIcon size={11} className="sc18-imgres-glyph" aria-hidden />
          <img
            className="sc18-imgres-thumb"
            src={it.src}
            alt={it.filename}
            draggable={false}
            loading="lazy"
          />
          <span className="sc18-imgres-cap">{imageCaption(it)}</span>
        </button>
      ))}
      {open !== null && items[open] && (
        <div className="sc18-imgres-lightbox" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <button
            type="button"
            className="sc18-imgres-close"
            title={t('common.close', 'Close')}
            aria-label={t('common.close', 'Close')}
            onClick={(e) => { e.stopPropagation(); setOpen(null); }}
          >
            <X size={14} />
          </button>
          <img
            className="sc18-imgres-full"
            src={items[open].src}
            alt={items[open].filename}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="sc18-imgres-lbcap">{imageCaption(items[open])}</span>
        </div>
      )}
    </div>
  );
});

// ---------------- tool result payload (v11.8 compact inline) ----------------
// v11.8 — results are NOT a click-gated drawer anymore: the first 6 lines
// always show in a soft monospace pre, "N more lines" expands to the full
// scrollable output, failures tint --bad and keep the one-click Error
// Explainer. The tool row above already carries OK/FAIL — this block is
// pure payload.
// v11.34 — image results bypass the <pre> entirely: raw base64/JSON is NEVER
// printed; a real <img> thumbnail + data caption is rendered instead.
const RESULT_PREVIEW_LINES = 6;

function ResultRow({ result, compact = false, meta }: { result: ChatMessage; compact?: boolean; meta?: string }) {
  const t = useT();
  const sendMessage = useStore((s) => s.sendMessage);
  const running = useStore((s) => s.running);
  const [full, setFull] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const ok = result.resultOk !== false;
  const text = result.content ?? '';
  // v11.34 — detect the REAL image payloads before the raw text ever reaches a
  // <pre>. Failed results never produce a thumbnail (honesty contract).
  const imageItems = useMemo(
    () => imageItemsOf(result.content, result.images, ok),
    [result.content, result.images, ok],
  );
  const lines = useMemo(() => (text ? text.split('\n') : []), [text]);
  // D14 — a trailing '\n' splits into an empty final element that is NOT a
  // visible line; counting it inflated "N more lines" by one (a tail newline
  // on tool output is the norm, so the count was almost always off by one).
  const visibleLines = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  const more = visibleLines - RESULT_PREVIEW_LINES;
  const shown = full ? text : lines.slice(0, RESULT_PREVIEW_LINES).join('\n');

  // v6 — Error Explainer (one click): the failed output becomes a teaching
  // moment — meaning, root cause, exact fix — then the fix is applied.
  const explainError = () => {
    if (explaining || running) return;
    setExplaining(true);
    const snippet = text.slice(0, 3000);
    void sendMessage(
      '[error coach] The tool output below FAILED. Respond in TWO parts:\n' +
        '1) EXPLAIN (in my UI language, simply): what this error means, the most likely root cause, and why it happened here.\n' +
        '2) FIX: apply the minimal fix yourself now (edit the right file(s)), then re-run the failed command to prove it is green.\n' +
        '---\n' +
        snippet,
    ).finally(() => setExplaining(false));
  };

  return (
    <div className={`sc18-res ${ok ? 'is-ok' : 'is-bad'} ${compact ? 'is-compact' : ''}`}>
      {meta && (
        <div className="sc18-res-head">
          <span dir="ltr">{meta}</span>
        </div>
      )}
      {imageItems.length > 0 ? (
        /* v11.34 — a real image result is a BITMAP, never raw base64/JSON. */
        <ImageResultGallery items={imageItems} />
      ) : (
        <>
          <pre className={`sc18-res-pre ${full && more > 0 ? 'is-full' : ''}`} dir="ltr">
            {shown || t('tool.noOutput', '(no output)')}
          </pre>
          {more > 0 && (
            <button
              className="sc18-res-more"
              onClick={() => setFull((v) => !v)}
              aria-expanded={full}
              title={full ? t('tool.showLess', 'Show less') : t('mv.res.more', '{n} more lines', { n: more })}
            >
              {full ? t('tool.showLess', 'Show less') : t('mv.res.more', '{n} more lines', { n: more })}
            </button>
          )}
        </>
      )}
      {!ok && (
        <button
          className="sc18-res-explain"
          disabled={explaining || running}
          onClick={explainError}
          title={t('tool.explainTitle', 'Ask SADEEM to explain the error and fix it')}
        >
          <GraduationCap size={12} className="shrink-0" />
          {explaining
            ? t('tool.explaining', 'Asking for an explanation…')
            : t('tool.explainError', 'Explain this error and fix it')}
        </button>
      )}
    </div>
  );
}

/** Parse tool_call args JSON defensively (never throws, never returns arrays). */
export function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Path-tail / command-head smart truncation for one-line summaries. */
function smartTruncValue(v: string): string {
  const pathish = !/\s/.test(v) && /[\\/]/.test(v);
  // paths read best from the tail (basename); commands from the head
  if (pathish && v.length > 44) return `…${v.slice(-43)}`;
  return trunc(v, 96);
}

/** One-line human summary of tool args (path / command / url / pattern…). */
export function argSummary(parsed: Record<string, unknown>): string {
  const cand =
    parsed.path ?? parsed.command ?? parsed.pattern ?? parsed.url ?? parsed.query ??
    parsed.template ?? parsed.id ?? parsed.action ?? parsed.prompt;
  return typeof cand === 'string' ? smartTruncValue(cand) : '';
}

// ---------------- v11.8 pretty-args drawer (the raw-JSON killer) ----------------
// Expanding a tool row reveals a STRUCTURED argument list — each key as a
// small caps label, each value styled by type: paths in code font with a
// copy button, multi-line text in a mini soft pre, numbers tabular. Long
// values clamp with a "Show all" toggle. No raw JSON dump, ever.

/** Keys that always read as paths (case-insensitive). */
const ARG_PATH_KEYS = /^(path|file|filepath|filename|dir|directory|folder|root|cwd|target|dest|destination|worktree|out(?:put)?(?:path|file|dir)?|source|src)$/i;
/** Inline strings longer than this clamp behind a Show-all toggle. */
const ARG_VALUE_MAX = 400;
/** Multi-line values show this many lines before clamping. */
const ARG_LINES_MAX = 10;

function isPathArg(key: string, v: string): boolean {
  if (ARG_PATH_KEYS.test(key)) return true;
  // path-shaped without spaces and a slash separator
  return !/\s/.test(v) && /[\\/]/.test(v) && v.length < 260;
}

/** One argument value, styled by type. */
function ArgValue({ k, v }: { k: string; v: unknown }) {
  const t = useT();
  const { copied, copy } = useCopyFeedback();
  const [showAll, setShowAll] = useState(false);

  if (typeof v === 'number') {
    return (
      <span className="sc18-arg-num tnum" dir="ltr">
        {String(v)}
      </span>
    );
  }
  if (typeof v === 'boolean') {
    return (
      <span className={`sc18-arg-bool ${v ? 'is-true' : 'is-false'}`} dir="ltr">
        {String(v)}
      </span>
    );
  }
  if (v == null) {
    return (
      <span className="sc18-arg-none" dir="ltr">
        —
      </span>
    );
  }
  if (typeof v === 'string') {
    if (v.includes('\n')) {
      // multi-line — mini soft pre, clamped to ARG_LINES_MAX until Show all
      const lines = v.split('\n');
      const clamped = !showAll && (lines.length > ARG_LINES_MAX || v.length > ARG_VALUE_MAX);
      return (
        <div className="sc18-arg-stack">
          <pre className="sc18-arg-pre" dir="ltr">
            {clamped ? lines.slice(0, ARG_LINES_MAX).join('\n') : v}
          </pre>
          {clamped && (
            <button className="sc18-arg-more" type="button" onClick={(e) => {
              e.stopPropagation();
              setShowAll(true);
            }}>
              {t('tool.showMore', 'Show all')}
            </button>
          )}
        </div>
      );
    }
    if (isPathArg(k, v)) {
      return (
        <span className="sc18-arg-path">
          <span className="sc18-arg-path-txt" dir="ltr" title={v}>
            {v}
          </span>
          <button
            className="sc18-arg-copy"
            type="button"
            title={t('chat.copy', 'Copy')}
            aria-label={t('chat.copy', 'Copy')}
            onClick={(e) => {
              e.stopPropagation();
              void copy(v);
            }}
          >
            {copied ? <Check size={10} className="text-ok" /> : <Copy size={10} />}
          </button>
        </span>
      );
    }
    const long = !showAll && v.length > ARG_VALUE_MAX;
    return (
      <span className="sc18-arg-stack sc18-arg-inline">
        <span className="sc18-arg-txt" dir="auto" title={v}>
          {long ? `${v.slice(0, ARG_VALUE_MAX)}…` : v}
        </span>
        {long && (
          <button className="sc18-arg-more" type="button" onClick={(e) => {
            e.stopPropagation();
            setShowAll(true);
          }}>
            {t('tool.showMore', 'Show all')}
          </button>
        )}
      </span>
    );
  }
  // objects / arrays — compact pretty JSON in the same clamped pre
  let json = '';
  try {
    json = JSON.stringify(v, null, 1) ?? 'null';
  } catch {
    json = String(v);
  }
  const lines = json.split('\n');
  const clamped = !showAll && lines.length > ARG_LINES_MAX;
  return (
    <div className="sc18-arg-stack">
      <pre className="sc18-arg-pre" dir="ltr">
        {clamped ? lines.slice(0, ARG_LINES_MAX).join('\n') : json}
      </pre>
      {clamped && (
        <button className="sc18-arg-more" type="button" onClick={(e) => {
          e.stopPropagation();
          setShowAll(true);
        }}>
          {t('tool.showMore', 'Show all')}
        </button>
      )}
    </div>
  );
}

/** Structured argument list — small caps key · typed value rows. */
function PrettyArgs({ parsed }: { parsed: Record<string, unknown> }) {
  const t = useT();
  const entries = Object.entries(parsed);
  if (!entries.length) {
    return (
      <div className="sc18-args" role="list">
        <span className="sc18-args-empty" dir="auto">
          {t('tool.noArgs', 'No arguments')}
        </span>
      </div>
    );
  }
  return (
    <div className="sc18-args" role="list">
      {entries.map(([k, v]) => (
        <div className="sc18-arg" role="listitem" key={k}>
          <span className="sc18-arg-k" dir="ltr">
            {k}
          </span>
          <div className="sc18-arg-v">
            <ArgValue k={k} v={v} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Cheap multiset line diffstat for write/edit cards — counts lines present
 * only in the new text (+) vs only in the old text (−). O(n) with maps; the
 * result is a stat indicator, not a patch, so near-duplicate lines are
 * acceptable drift.
 */
function lineDiffStat(oldText: string, newText: string): { add: number; del: number } | null {
  if (oldText === newText) return null;
  const tally = (t: string) => {
    const m = new Map<string, number>();
    for (const l of t.split('\n')) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = tally(oldText);
  const b = tally(newText);
  let add = 0;
  let del = 0;
  for (const [l, n] of a) {
    const d = n - (b.get(l) ?? 0);
    if (d > 0) del += d;
  }
  for (const [l, n] of b) {
    const d = n - (a.get(l) ?? 0);
    if (d > 0) add += d;
  }
  return add === 0 && del === 0 ? null : { add, del };
}

// ---------------- v8.2 gate-row verdict chips ----------------
// The engine streams gate announcements as plain assistant text
// ("[mutation gate] PASSED — …", "[critic] 2 critical finding(s)…"). When a
// message STARTS with a known gate tag we render a compact verdict pill plus
// a collapsible plain-text body instead of markdown — message rendering ONLY
// (the store is untouched, no information is lost: the body keeps the full
// original text).
// NOTE: red→green is a PREFIX match — the engine also emits the
// "[red→green ENFORCED]" variant, so anything up to ']' belongs to the tag.
const GATE_TAG_RE = /^\s*\[(mutation gate|red→green[^\]]*|fake-test gate|critic|claim audit|proof)\]/;

type GateTone = 'ok' | 'bad' | 'warn' | 'neutral';

interface GateInfo {
  tag: string; // matched tag text, e.g. 'mutation gate'
  tone: GateTone; // pill color family
  verdict: string | null; // uppercase verdict token (PASSED / FAILED / …)
  brief: string; // rest of the first line after the tag — the pill's detail
}

/**
 * Verdict extraction — scanning ONLY the "verdict zone" (the first line
 * after the tag, up to the first em-dash). The engine always puts the
 * verdict before the detail ("[mutation gate] FAILED — detail…"), so a
 * 'PASSED' inside a FAILED line's detail can never flip the pill.
 * All regexes are case-insensitive-ish on the fixed engine vocabulary and
 * every branch is optional — unknown text degrades to a neutral chip.
 */
function gateVerdict(zone: string, tag: string): { tone: GateTone; verdict: string | null } {
  const killed = /KILLED[^\d]*?(\d+)\s*\/\s*(\d+)/.exec(zone); // cli form: "KILLED 3/4 (75%)"
  if (killed) return { tone: 'ok', verdict: `KILLED ${killed[1]}/${killed[2]}` };
  const crit = /(\d+)\s+critical/i.exec(zone); // "[critic] 2 critical finding(s)…"
  if (crit && Number(crit[1]) > 0) return { tone: 'warn', verdict: `${crit[1]} CRIT` };
  if (/ENFORCED/i.test(tag)) return { tone: 'warn', verdict: 'ENFORCED' }; // [red→green ENFORCED]
  if (/\bPASSED\b/i.test(zone)) return { tone: 'ok', verdict: 'PASSED' };
  if (/\bPROVEN\b/i.test(zone)) return { tone: 'ok', verdict: 'PROVEN' };
  if (/\bCLEAN\b/i.test(zone)) return { tone: 'ok', verdict: 'CLEAN' };
  if (/\bFAILED\b/i.test(zone)) return { tone: 'bad', verdict: 'FAILED' };
  if (/\bINCONCLUSIVE\b/i.test(zone)) return { tone: 'warn', verdict: 'INCONCLUSIVE' };
  if (/\bPARTIAL\b/i.test(zone)) return { tone: 'warn', verdict: 'PARTIAL' };
  if (/\bUNPROVEN\b/i.test(zone)) return { tone: 'warn', verdict: 'UNPROVEN' };
  return { tone: 'neutral', verdict: null };
}

/** Match a gate row; returns null for any message that does not START with a gate tag. */
function matchGate(content: string): GateInfo | null {
  try {
    const m = GATE_TAG_RE.exec(content);
    if (!m) return null;
    const tag = m[1];
    const firstLine = (content.slice(m[0].length).split('\n')[0] ?? '').trim();
    const dash = firstLine.search(/—|--/); // em-dash separates verdict from detail
    const zone = dash >= 0 ? firstLine.slice(0, dash) : firstLine;
    const { tone, verdict } = gateVerdict(zone, tag);
    return { tag, tone, verdict, brief: trunc(firstLine, 160) };
  } catch {
    return null;
  }
}

/** Compact verdict chip for gate rows — pill + collapsible plain-text body. */
function GateVerdictChip({ info, content }: { info: GateInfo; content: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const color =
    info.tone === 'ok' ? 'var(--ok)' : info.tone === 'bad' ? 'var(--bad)' : info.tone === 'warn' ? 'var(--warn)' : 'var(--dim)';
  const stampCls =
    info.tone === 'ok' ? 'stamp-acc' : info.tone === 'bad' ? 'stamp-bad' : info.tone === 'warn' ? 'stamp-warn' : '';
  return (
    <div className="gate-row anim-in msg-in" style={{ '--gate-c': color } as React.CSSProperties}>
      <button
        className="gate-pill"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={
          open
            ? t('mv.gate.hide', 'Hide details')
            : t('mv.gate.details', 'Show full details')
        }
      >
        <span className="gate-tag" dir="ltr">
          {info.tag}
        </span>
        {info.verdict && (
          <span className={`gate-verdict stamp ${stampCls} !h-[15px] !px-1.5 !text-[9px]`} dir="ltr">
            {info.verdict}
          </span>
        )}
        {info.brief && (
          <span className="gate-brief" dir="auto">
            {info.brief}
          </span>
        )}
        <ChevronDown size={11} className={`sc-tl-caret shrink-0 ${open ? 'is-open' : ''}`} />
      </button>
      {open && (
        <pre className="gate-body" dir="auto">
          {content}
        </pre>
      )}
    </div>
  );
}

// ---------------- v10.2 word-diff preview removed ----------------
// Superseded by DiffView (src/components/DiffView.tsx) + lib/linediff.ts:
// full-hunk before/after cards with real line numbers and a Unified|Split
// toggle replace the old 8-row collapsed preview. lineDiffStat below stays
// (it powers the compact +N −M chip in the tool row header).

// ---------------- main ----------------
export interface MessageViewProps {
  msg: ChatMessage;
  /** Matched tool_result for a tool_call row (kept stable so memo works). */
  result?: ChatMessage;
  /** True when this is the newest assistant message (enables Retry). */
  canRetry?: boolean;
  /** Re-send the last user message — stable callback from ChatPanel. */
  onRetry?: () => void;
  /** v11.8 — true on the FIRST assistant row of a turn group: only that row
   *  renders the agent-dot + model stamp header; every later row stays
   *  clean (the model + time remain in its hover action bar). */
  turnStart?: boolean;
}

/**
 * D2 — CROSS-TEAM contract: the store persists `thinkMs` (integer ms) on
 * finalized assistant messages and the engine emits it in message_end.
 * Declared here so the transcript compiles against the contract before the
 * shared ChatMessage type carries the field; it is read defensively and is
 * absent in old sessions (the client-measured duration remains the fallback).
 */
type ChatMessageWithThinkMs = ChatMessage & { thinkMs?: number };

// ---------------- v2.1 meta renderers (synthetic engine rows) ----------------

/** Defensive JSON parse for synthetic meta payloads (never throws). */
function parseMeta(content: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(content);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** CTX compaction divider — slim mono line between pre/post compaction.
 *  v11.31 — the label is now monolingual in each language (no English prose
 *  leaked into an Arabic transcript) and the numbers use the digit formatter. */
function CompactionDivider({ content }: { content: string }) {
  const t = useT();
  const n = useDigits();
  const ar = useStore((s) => s.settings?.language === 'ar');
  const d = parseMeta(content);
  const before = typeof d?.before === 'number' ? n(Math.round(d.before)) : '—';
  const after = typeof d?.after === 'number' ? n(Math.round(d.after)) : '—';
  return (
    <div className="sc-divider anim-in msg-in sc-continuity" role="separator">
      <span className="sc-continuity-mark" aria-hidden />
      <span className="tnum" dir="ltr">
        {t('mv.compaction', ar ? `ضغط السياق ${before}٪ ← ${after}٪` : `CTX compaction ${before}% → ${after}%`)}
      </span>
    </div>
  );
}

/** Engine-run verification — VERIFY tl-row (warn keyline) + output drawer. */
function VerifyRow({ content }: { content: string }) {
  const t = useT();
  const n = useDigits();
  const [open, setOpen] = useState(false);
  const d = parseMeta(content);
  const cmd = typeof d?.cmd === 'string' ? d.cmd : '';
  const exitCode = typeof d?.exitCode === 'number' ? d.exitCode : -1;
  const tail = typeof d?.outputTail === 'string' ? d.outputTail : '';
  const ok = exitCode === 0;
  return (
    <div className="w-full min-w-0 anim-in msg-in">
      <div
        className="tl-row cursor-pointer select-none"
        role="button"
        tabIndex={0}
        style={{ '--verb-c': 'var(--warn)' } as React.CSSProperties}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          // D12 — Space toggles too (a11y parity with native buttons);
          // preventDefault stops the page from scrolling.
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span className="tl-verb" dir="ltr">
          VERIFY
        </span>
        <span className="tl-detail" dir="ltr" title={cmd}>
          {trunc(cmd, 140) || t('tool.noOutput', '(no output)')}
        </span>
        <span className="tl-meta flex items-center gap-1.5">
          <span className={`stamp ${ok ? 'stamp-acc' : 'stamp-bad'} !h-[14px] !px-1 !text-[8.5px]`} dir="ltr">
            {`EXIT ${n(exitCode)}`}
          </span>
          <ChevronDown size={11} className={`sc-tl-caret ${open ? 'is-open' : ''}`} />
        </span>
      </div>
      {open && (
        <div className="sc-tl-out">
          <div className="fhdr">
            {/* v7.2 — localized output header (was hardwired 'OUTPUT · exit N') */}
            <span dir="ltr">{t('mv.output.exit', `OUTPUT · exit ${n(exitCode)}`, { n: n(exitCode) })}</span>
          </div>
          <pre className="sc-tl-out-pre">{tail || t('tool.noOutput', '(no output)')}</pre>
        </div>
      )}
    </div>
  );
}

/** Background-subagent live progress — 2px sage track, completes at 100%. */
function SubagentRow({ content }: { content: string }) {
  const d = parseMeta(content);
  const label = typeof d?.label === 'string' ? d.label : 'subagent';
  const done = typeof d?.done === 'number' ? d.done : 0;
  const total = typeof d?.total === 'number' ? d.total : 0;
  const complete = total > 0 && done >= total;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className={`sc-sg-row anim-in msg-in ${complete ? 'is-done' : ''}`} role="status">
      {complete ? (
        <CheckCircle2 size={11} className="text-ok shrink-0" />
      ) : (
        <Spinner size={11} />
      )}
      <ProgressRing done={done} total={total} size={11} />
      <span className="sc-sg-label" title={label}>
        {label}
      </span>
      <span className="sc-sg-track" aria-hidden>
        <span className="sc-sg-fill" style={{ width: `${Math.max(3, pct)}%` }} />
      </span>
      <span className="tl-meta tnum" dir="ltr">
        {`${done}/${total}`}
      </span>
    </div>
  );
}

/** Structured review findings — severity stamps + file + note.
 *  v11.31 — a clean review (zero findings) now renders an honest calm header
 *  instead of vanishing into a blank gap; counts are localized + digit-formed. */
function FindingsCard({ content }: { content: string }) {
  const t = useT();
  const n = useDigits();
  const ar = useStore((s) => s.settings?.language === 'ar');
  const d = parseMeta(content);
  const findings: ReviewFinding[] = Array.isArray(d?.findings) ? (d.findings as ReviewFinding[]) : [];
  const summary = typeof d?.summary === 'string' ? d.summary : undefined;
  const head = (
    <>
      <ShieldCheck size={12} className="text-acc shrink-0" />
      <span className="uppercase tracking-widest shrink-0">{t('chat.reviewTitle', 'REVIEW')}</span>
    </>
  );
  if (findings.length === 0) {
    return (
      <div className="sc-findings anim-in msg-in min-w-0">
        <div className="sc-findings-head">
          {head}
          {summary && (
            <span className="truncate min-w-0 flex-1 opacity-80" title={summary} dir="auto">
              {summary}
            </span>
          )}
          <span className="stamp stamp-acc shrink-0">{t('mv.findings.none', ar ? 'لا ملاحظات' : 'NO FINDINGS')}</span>
        </div>
      </div>
    );
  }
  const sevOf = (s: string): [string, string] =>
    s === 'critical'
      ? ['CRIT', 'sc-sev-crit']
      : s === 'major'
        ? ['MAJ', 'sc-sev-maj']
        : s === 'minor'
          ? ['MIN', 'sc-sev-min']
          : ['NIT', 'sc-sev-nit'];
  return (
    <div className="sc-findings anim-in msg-in min-w-0">
      <div className="sc-findings-head">
        {head}
        {summary && (
          <span className="truncate min-w-0 flex-1 opacity-80" title={summary} dir="auto">
            {summary}
          </span>
        )}
        <span className="stamp stamp-clay shrink-0">
          {t('mv.findings.count', ar ? `${n(findings.length)} ملاحظة` : `${n(findings.length)} FINDINGS`)}
        </span>
      </div>
      <div>
        {findings.map((f, i) => {
          const [lbl, cls] = sevOf(String(f.severity ?? 'nit'));
          return (
            <div className="finding" key={`${f.file}:${f.line ?? ''}:${i}`}>
              <span className={`f-sev ${cls}`}>{lbl}</span>
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
    </div>
  );
}

// ---------------- v6 Apex meta cards ----------------
// Kept for the generic untrusted-JSON meta guard (not a proof row).
const META_KEYS_RE = /^(summary|claims|unsupported|findings|critical|honest|detail|verdict|files|commands|rounds|verifyFailed|durationMs|goal|compliant|reason|id|file|markdown|scanned|high|why|origin|sources)$/;

/** Goal verifier confirmed completion from real evidence — one calm line. */
function looksLikeMetaJson(content: string | undefined | null): Record<string, unknown> | null {
  // Defensive: an untrusted IPC row may omit `content`. Never throw in render
  // (same contract as splitContent) — an absent body simply isn't meta JSON.
  const s = typeof content === 'string' ? content.trim() : '';
  if (!s.startsWith('{') || !s.endsWith('}')) return null;
  try {
    const v: unknown = JSON.parse(s);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const keys = Object.keys(v as Record<string, unknown>);
    if (!keys.length || keys.length > 8) return null;
    return keys.every((k) => META_KEYS_RE.test(k)) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
function JsonMetaChip({ content }: { content: string }) {
  const t = useT();
  const ar = useStore((s) => s.settings?.language === 'ar');
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full min-w-0 anim-in msg-in">
      <button className="tl-row select-none w-full" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="tl-verb" dir="ltr">META</span>
        <span className="tl-detail" dir="auto">
          {t('mv.meta.inspect', ar ? 'بيانات وصفية من المحرك — انقر للفحص' : 'Engine meta payload — click to inspect')}
        </span>
        <ChevronDown size={11} className={`sc-tl-caret shrink-0 ${open ? 'is-open' : ''}`} />
      </button>
      {open && (
        <pre className="ms-6 mt-1 mb-1 select-text font-code text-[11px] max-h-40 overflow-auto bg-[var(--bg2)] border border-line rounded-[3px] p-2 whitespace-pre-wrap break-all" dir="ltr">
          {content}
        </pre>
      )}
    </div>
  );
}

// ---------------- tool_call → Aurora slim status row (.tl2-* grammar) ----------
// Own component so its hooks (expand state, diffstat memo, auto-open effect)
// never sit behind MessageViewRow's early returns.

/** Status pill — running (verb-colored + spinner) / ok / error / denied.
 *  v11.8 — duration folds INTO the chip: one quiet "OK 512ms" stamp.
 *  v11.11 (wave3-A2) — the status speaks as a GLYPH first (running spinner →
 *  done check → error ×), with the static text kept so state never rides on
 *  glyph or color alone. */
function StatusPill({ running, ok, denied, dur }: { running: boolean; ok: boolean; denied: boolean; dur?: string }) {
  const t = useT();
  if (running) {
    return (
      <span className="tl2-pill is-run" title={t('chat.run.running', 'Running')}>
        <Spinner size={8} />
        <span dir="ltr">{t('mv.pill.running', 'RUN')}</span>
      </span>
    );
  }
  if (!ok) {
    return (
      <span
        className={`tl2-pill ${denied ? 'is-denied' : 'is-bad'}`}
        title={denied ? t('chat.deny', 'Denied') : t('chat.run.failed', 'Failed')}
      >
        <X size={8} aria-hidden />
        <span dir="ltr">{denied ? t('mv.pill.denied', 'DENIED') : t('mv.pill.error', 'ERROR')}</span>
      </span>
    );
  }
  return (
    <span className="tl2-pill is-ok" title={dur ? `${t('chat.run.done', 'Done')} · ${dur}` : t('chat.run.done', 'Done')}>
      <Check size={9} aria-hidden />
      <span dir="ltr">
        {t('mv.pill.ok', 'OK')}
        {dur ? ` ${dur}` : ''}
      </span>
    </span>
  );
}

/** Tool family → one compact caps verb for the row (static Latin vocabulary,
 *  same law as the band words THINK/WORK/BUILD/RUN/PROVE — never translated,
 *  never mirrored). v11.11 (wave3-A2): the verb is DERIVED from the tool
 *  family — creation speaks CREATE, not EDIT — and web/browser collapse into
 *  the browser family's 'web' verb. */
function toolVerbLabel(isMcp: boolean, verb: string): string {
  if (isMcp) return 'MCP';
  switch (verb) {
    case 'write':
      return 'CREATE';
    case 'edit':
      return 'EDIT';
    case 'read':
      return 'READ';
    case 'grep':
      return 'SEARCH';
    case 'run':
      return 'RUN';
    case 'think':
      return 'PLAN';
    case 'web':
      return 'BROWSER';
    default:
      return 'TOOL';
  }
}

/** Primary argument, human-first: the path for file tools, the command for
 *  runs, the query for searches, the URL for the web — the ONE string that
 *  says what this call touches (full value rides the title attribute). */
function primaryArgOf(toolName: string | undefined, parsed: Record<string, unknown>): string {
  const n = toolName ?? '';
  const str = (x: unknown): string => (typeof x === 'string' ? x : '');
  if (n === 'run_command' || n === 'run_background' || n === 'stop_process') return str(parsed.command) || str(parsed.cmd);
  if (n === 'search_files' || n === 'code_search' || n === 'web_search' || n === 'search_web')
    return str(parsed.pattern) || str(parsed.query);
  if (n === 'web_fetch' || n.startsWith('browser_')) return str(parsed.url);
  if (n === 'todo_write' || n === 'task' || n === 'use_skill')
    return str(parsed.title) || str(parsed.id) || str(parsed.skill) || str(parsed.prompt);
  return str(parsed.path) || str(parsed.file) || argSummary(parsed);
}

// ---------------- tool_call → v11.11 family-skinned card (.tl2 + .tv-*) -------
// wave3-A2 — every tool family gets its OWN visual treatment on the shared
// one-line instrument grammar (icon · caps verb · chips · arg · status):
//   write   CREATE  lime left-rail · filename chip · "N ln" size badge
//   edit    EDIT    amber-cast rail · filename chip · diffstat · DiffView
//   read    READ/SEARCH  cool steel · one-shot scanned sheen · lines/hits chip
//   bash    RUN     dark terminal strip · $ prompt glyph · EXIT code badge
//   browser BROWSER sage-cast steel · URL host chip · screenshot thumbnail
//   mcp     MCP     violet-cast steel · server-name chip
//   think   PLAN    untouched (brand-mark THINK coding — wave2-A1)
//   other   TOOL    neutral, same polished grammar
// Consecutive same-family calls MERGE into a tight stack with a "×N" chip.
// Family hue rides --verb-c from the --tvf-* token set (chat.css) — no hex.

/** Family → CSS custom property carrying the family hue (--tvf-* live in
 *  chat.css, token-derived so light/dark/high themes adapt for free). */
const FAM_VAR: Record<ToolFamily, string> = {
  write: 'var(--tvf-write, var(--acc))',
  edit: 'var(--tvf-edit, var(--v-edit))',
  read: 'var(--tvf-read, var(--v-read))',
  bash: 'var(--tvf-bash, var(--v-run))',
  browser: 'var(--tvf-browser, var(--acc2))',
  mcp: 'var(--tvf-mcp, var(--v-think))',
  think: 'var(--v-think)',
  other: 'var(--dim)',
};

/** read-family members whose result is a hit list, not a file body. */
const SEARCH_TOOLS: ReadonlySet<string> = new Set([
  'search_files',
  'code_search',
  'search_grep',
  'grep',
  'web_search',
  'search_web',
]);

/** Lines/hits counter chip for the READ family ("scanned" receipt). */
function readCountOf(toolName: string, result?: ChatMessage): { n: number; unit: string } | null {
  if (!result) return null;
  const text = result.content ?? '';
  if (!text.trim()) return null;
  const lines = text
    .replace(/\n+$/, '')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (!lines.length) return null;
  return { n: lines.length, unit: SEARCH_TOOLS.has(toolName) ? 'hits' : 'lines' };
}

function ToolCallCard({ msg, result }: { msg: ChatMessage; result?: ChatMessage }) {
  const t = useT();
  const n = useDigits();
  const ar = useStore((s) => s.settings?.language === 'ar');
  // v11.31 — the args copy button shares the honest copy path (real write, no
  // false 'Copied'); a failed write toasts instead of silently pretending.
  const { copy: copyArgs } = useCopyFeedback();
  // v11.11 (wave3-A2) — COLLAPSED by default for every family (the founder's
  // declutter mandate): the one-line header carries the story — verb · chip ·
  // diffstat · status — and args/diff/output live one click away. Supersedes
  // the v10.2 edit/write auto-open.
  const [expanded, setExpanded] = useState(false);

  const isMcp = !!msg.toolName?.startsWith('mcp__');
  const label = msg.toolName
    ? isMcp
      ? `${t('tool.mcp')} · ${msg.toolName.replace(/^mcp__/, '')}`
      : t(`tool.${msg.toolName}`, msg.toolName)
    : t('tool.mcp');

  const parsed = parseToolArgs(msg.content);
  const planTodos: TodoItem[] = Array.isArray(parsed.todos) ? (parsed.todos as TodoItem[]) : [];

  // v10.2 — Codex-class before/after diff. FIX: v10.1 read `parsed.oldText`
  // keys the tools never send (edit_file sends old_string/new_string,
  // write_file sends content) — the diffstat and preview were dead code.
  const diffInputs = useMemo(
    () => diffInputsFromToolArgs(msg.toolName ?? '', parsed),
    // parsed is derived from msg.content — content is the real dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [msg.toolName, msg.content],
  );

  // wave3-A2 — family identity: hue (--tvf-*), verb, skin class all derive
  // from ONE classification so a tool can never drift between surfaces.
  const fam = toolFamilyOf(msg.toolName);
  const famVar = FAM_VAR[fam];
  const famClass = `tv-${fam}`;
  const verb = isMcp
    ? 'mcp'
    : fam === 'browser'
      ? 'web'
      : fam === 'bash'
        ? 'run'
        : fam === 'write'
          ? 'write'
          : fam === 'edit'
            ? 'edit'
            : fam === 'think'
              ? 'think'
              : SEARCH_TOOLS.has(msg.toolName ?? '')
                ? 'grep'
                : 'read';
  const verbLabel = toolVerbLabel(isMcp, verb);
  const TIco = toolIcon(msg.toolName);
  const isPowerTool = POWER_TOOLS.has(msg.toolName ?? '');

  // v11.8 — the ONE primary argument as text (paths read as their basename;
  // the full value rides the title so nothing is lost). Commands never
  // basename — `./scripts/build.sh` must stay whole.
  const argRaw = primaryArgOf(msg.toolName, parsed);
  const isCommandTool = msg.toolName === 'run_command' || msg.toolName === 'run_background' || msg.toolName === 'stop_process';
  const argIsPath = argRaw.length > 0 && !isCommandTool && isPathArg('path', argRaw);
  const argShown = argIsPath ? (argRaw.split(/[\\/]/).pop() || argRaw) : argRaw;
  const argTitle = argRaw || label;

  // wave3-A2 — family chips. write/edit: filename chip (full path on title);
  // browser: URL HOST chip (path+query remain the arg); mcp: server chip.
  const famChip =
    fam === 'write' || fam === 'edit'
      ? argIsPath
        ? argRaw.split(/[\\/]/).pop() || argRaw
        : ''
      : fam === 'browser'
        ? (() => {
            try {
              const u = new URL(argRaw);
              return u.hostname || '';
            } catch {
              return '';
            }
          })()
        : fam === 'mcp'
          ? (msg.toolName?.replace(/^mcp__/, '').split('__')[0] ?? '')
          : '';
  const urlRest = (() => {
    if (fam !== 'browser' || !famChip) return null;
    try {
      const u = new URL(argRaw);
      return `${u.pathname === '/' ? '' : u.pathname}${u.search}`;
    } catch {
      return null;
    }
  })();
  // the flexible arg slot: hidden when a chip already says it (write/edit),
  // shows the URL tail for browser, full fallback otherwise
  const argRest =
    fam === 'browser' && urlRest !== null
      ? urlRest
      : fam === 'write' || fam === 'edit'
        ? ''
        : argShown || msg.toolName || label;

  // wave3-A2 — family receipts:
  // write → size badge (line count of the created content)
  const writeLines =
    fam === 'write' && typeof parsed.content === 'string' && parsed.content.length
      ? parsed.content.replace(/\n$/, '').split('\n').length
      : null;
  // read → "N lines / N hits" chip once the result lands (localized unit)
  const readCount = fam === 'read' ? readCountOf(msg.toolName ?? '', result) : null;
  const readUnit = readCount?.unit === 'hits'
    ? t('mv.unit.hits', ar ? 'نتائج' : 'hits')
    : t('mv.unit.lines', ar ? 'أسطر' : 'lines');
  // bash → EXIT code badge (green 0 / red non-zero)
  const exitInfo = (() => {
    if (msg.toolName !== 'run_command' || !result) return null;
    const tail = (result?.content ?? '').slice(-300);
    const m = tail.match(/exit(?:\s*code|\s*:)?\s*(-?\d+)/i);
    if (m) return m[1];
    return result.resultOk ? '0' : null;
  })();
  // browser → screenshot thumbnail when the result carries an inline image
  const shotSrc = useMemo(() => {
    if (fam !== 'browser' || !result) return null;
    const m = /data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]{128,}/.exec(result.content ?? '');
    return m ? m[0] : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fam, result]);

  // wave3-A2 — consecutive same-family cards MERGE: this card's ordinal in
  // its run (1 = head, 2..N = stacked continuations). The scan walks REAL
  // sibling rows (narration/other families break the run), and the grouping
  // math lives in the unit-tested toolGrouping lib.
  const rootRef = useRef<HTMLDivElement>(null);
  const [stackOrdinal, setStackOrdinal] = useState(1);
  useLayoutEffect(() => {
    const el = rootRef.current;
    const famAttr = el?.getAttribute('data-tvfam');
    if (!el || !famAttr) return;
    const prevFams: string[] = [];
    let sib = el.previousElementSibling;
    while (sib) {
      const k = sib.getAttribute('data-tvfam');
      if (!k) break;
      prevFams.unshift(k);
      sib = sib.previousElementSibling;
    }
    setStackOrdinal(toolRunOrdinal(prevFams, famAttr));
  }, [fam, !!result, msg.id]);
  const stacked = stackOrdinal > 1;

  // write/edit diffstat (+N −N) — v10.2: from the normalized diff inputs
  const diff = useMemo(() => {
    if (!diffInputs) return null;
    return lineDiffStat(diffInputs.oldText, diffInputs.newText);
  }, [diffInputs]);

  const ms = result ? Math.max(0, result.timestamp - msg.timestamp) : null;
  const denied = !!result && (result.content || '').includes('denied');
  const failed = !!result && result.resultOk === false;
  const durStr = ms !== null ? (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`) : undefined;
  // v11.19 — one status source of truth: the SAME value drives data-status and
  // the one-shot bloom mount, so the bloom can never fire on a non-done card.
  const status: 'running' | 'denied' | 'error' | 'done' = !result
    ? 'running'
    : failed
      ? (denied ? 'denied' : 'error')
      : 'done';

  return (
    <div
      ref={rootRef}
      data-tvfam={fam}
      className={`w-full min-w-0 anim-in msg-in ${stacked ? 'tv-stacked' : ''}`}
    >
      {/* v11.11 one-line instrument row: family-hued tool icon · caps verb ·
          family chip (filename / host / server) · stack counter · diffstat ·
          receipts (lines / hits / EXIT / thumbnail) · status glyph · caret.
          Collapsed by default — the drawer below holds args + diff. */}
      <div
        className={`tl2-card cursor-pointer select-none ${famClass} ${!result ? 'is-running' : ''} ${
          failed ? (denied ? 'is-denied' : 'is-error') : ''
        } ${stacked ? 'is-stacked' : ''}`}
        data-status={status}
        style={{ '--verb-c': famVar } as React.CSSProperties}
      >
        <div
          className="tl2-head"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          title={label}
          onClick={() => setExpanded((v) => !v)}
          onKeyDown={(e) => {
            // D12 — Space toggles too (a11y parity with native buttons);
            // preventDefault stops the page from scrolling.
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setExpanded((v) => !v);
            }
          }}
        >
          <span className="sc18-tico" aria-hidden>
            <StoryGlyph name={msg.toolName} />
          </span>
          <span className="sc18-tverb" dir="ltr">
            {verbLabel}
          </span>
          {famChip && (
            <span className="tv-chip" title={fam === 'browser' ? argTitle : argRaw || label}>
              {isPowerTool && <TIco size={9} className="tv-chip-glyph" aria-hidden />}
              <span className="tv-chip-txt" dir="ltr">
                {famChip}
              </span>
            </span>
          )}
          {stacked && (
            <span
              className="tv-stack"
              dir="ltr"
              title={t('mv.stack.sameTool', '{name} · call {n} in a row', { name: msg.toolName ?? '', n: stackOrdinal })}
            >
              {(msg.toolName ?? '').replace(/^mcp__/, '')} ×{n(stackOrdinal)}
            </span>
          )}
          {diff && (
            <span className="tl2-diff tnum shrink-0 press" dir="ltr" title={`+${diff.add} −${diff.del}`}>
              <b className="tl2-diff-add">{`+${diff.add}`}</b>
              <b className="tl2-diff-del">{`−${diff.del}`}</b>
            </span>
          )}
          <span className="sc18-targ" dir="ltr" title={argTitle}>
            {argRest}
          </span>
          {writeLines !== null && (
            <span className="tv-badge tnum shrink-0" dir="ltr" title={t('mv.badge.lines', '{n} lines', { n: writeLines })}>
              {n(writeLines)} {t('mv.unit.lines', ar ? 'سطر' : 'ln')}
            </span>
          )}
          {readCount && (
            <span
              className="tv-badge tnum shrink-0"
              dir="ltr"
              title={t('mv.badge.count', '{n} {unit}', { n: readCount.n, unit: readUnit })}
            >
              {n(readCount.n)} {readUnit}
            </span>
          )}
          {shotSrc && <img className="tv-shot" src={shotSrc} alt="" draggable={false} />}
          <span className="tl2-meta flex items-center gap-1.5 shrink-0">
            {exitInfo !== null && (
              <span className={`tv-exit tnum ${failed ? 'is-bad' : 'is-ok'}`} dir="ltr" title={`EXIT ${n(exitInfo)}`}>
                EXIT {n(exitInfo)}
              </span>
            )}
            <StatusPill running={!result} ok={!!result && result.resultOk !== false} denied={denied} dur={durStr} />
            <ChevronDown size={11} className={`sc-tl-caret ${expanded ? 'is-open' : ''}`} />
          </span>
        </div>

        {/* Artistic hairline: drawn in with art-draw when the call starts,
            then settles to a faint static rule when the result lands. It is
            absolute-positioned — no layout shift, no new capability. */}
        <span className="tv-draw-rule" aria-hidden />

        {/* two-stage instrument draw: the top rule (.tv-draw-rule) draws on
            start, this left rule draws when the result lands. */}
        <span className="tv-complete-rule" aria-hidden />

        {/* wave3-A2 — slim indeterminate progress line UNDER the header while
            the call runs (transform-sweep, logical RTL mirror); unmounts on
            completion. Replaces the old top-edge scan bar for tool cards. */}
        {!result && <span className="tv-runline" aria-hidden />}

        {/* v11.19 — per-tool completion bloom: mounted ONLY when status flips
            to 'done', so A15's one-shot check + radiating-ring CSS plays once
            (never looped, never re-triggered by unrelated store ticks). */}
        {status === 'done' && <ToolBloom />}

        {expanded && (
          <div className="sc-tl-out tl2-out sc18-drawer">
            {/* structured args drawer — small caps key · typed value */}
            <div className="sc18-args-head">
              <span className="sc-mono-xs uppercase tracking-widest text-faint shrink-0">
                {t('tool.args', 'Arguments')}
              </span>
              <button
                className="ms-auto inline-flex items-center gap-1 sc-mono-xs text-faint hover:text-[var(--ink)] transition-colors cursor-pointer"
                title={t('tool.copyArgs', 'Copy arguments')}
                aria-label={t('tool.copyArgs', 'Copy arguments')}
                onClick={(e) => {
                  e.stopPropagation();
                  void copyArgs(msg.content);
                }}
              >
                <Copy size={10} />
              </button>
            </div>
            {msg.toolName === 'todo_write' && planTodos.length > 0 ? (
              <div className="sc18-args sc18-args-todo">
                <TodoRows todos={planTodos} />
              </div>
            ) : (
              <PrettyArgs parsed={parsed} />
            )}
            {/* v10.2 — Codex-class before/after diff (the EDIT family mini-view):
                hunks with real line numbers, add/del tints, Unified | Split
                toggle, word highlight — height-clamped with expand. */}
            {diffInputs && (
              <DiffView
                path={typeof parsed.path === 'string' ? parsed.path : undefined}
                oldText={diffInputs.oldText}
                newText={diffInputs.newText}
                compact
              />
            )}
          </div>
        )}

        {/* v11.8 — the result ALWAYS shows inline (first 6 lines, expandable,
            errors tinted): no click gate between the call and its output.
            wave3-A2: the EXIT badge moved to the header for bash. */}
        {result && <ResultRow result={result} />}
      </div>
    </div>
  );
}

function MessageViewRow({ msg, result, canRetry, onRetry, turnStart }: MessageViewProps) {
  const t = useT();
  const n = useDigits();
  const { copied, copy } = useCopyFeedback();

  const segments = useMemo(
    () => (msg.role === 'assistant' && msg.kind !== 'tool_call' ? splitContent(msg.content) : null),
    [msg.role, msg.kind, msg.content],
  );

  // v11.26/v11.28 — the founder wants the ENTIRE proof/gates section gone,
  // leaving only the small PROOF button. These synthetic rows are that
  // section: drop them all. The written task-report row is gone too (the
  // report data lives in the store; A2 surfaces it as a toast) — never a
  // card, never raw JSON. Real command output (verify) and subagents are
  // NOT proof rows and stay.
  const PROOF_ONLY_ROWS = new Set([
    'goal-verified', 'critic', 'receipt', 'proof', 'mutation-gate',
    'red-green', 'fake-tests', 'claim-audit', 'mutation-check',
    'task-report',
  ]);
  if (msg.role === 'assistant' && PROOF_ONLY_ROWS.has(String(msg.model ?? ''))) {
    return null;
  }
  // ---------------- v2.1 meta rows (synthetic engine messages) ----------------
  if (msg.role === 'assistant' && msg.model === 'compaction') {
    return <CompactionDivider content={msg.content} />;
  }
  if (msg.role === 'assistant' && msg.model === 'verify') {
    return <VerifyRow content={msg.content} />;
  }
  if (msg.role === 'assistant' && msg.model === 'subagent') {
    return <SubagentRow content={msg.content} />;
  }
  if (msg.role === 'assistant' && msg.model === 'review-findings') {
    return <FindingsCard content={msg.content} />;
  }
  // ---------------- v6 Apex meta rows ----------------
  // ---------------- v7.1 Proven Change meta rows ----------------
  // ---------------- v11.7 — the two leaked-JSON cards + the safety net ----------------

  // ---------------- v11.3 dedicated notice chips (sys_notice channel) ----------------
  if (msg.role === 'assistant' && msg.kind === 'notice') {
    return <NoticeChip kind={msg.noticeKind} content={msg.content} />;
  }

  // ---------------- user ----------------
  // v11.8 — the user's input is unmistakable: a compact right-aligned bubble
  // (mirrored in RTL via logical properties) with an accent-tinted hairline,
  // user icon, 10px radius — never mistaken for agent output.
  if (msg.role === 'user') {
    const isSteer = msg.model === 'steer';
    const isQueued = msg.model === 'queued';
    return (
      <div className="sc-msgrow anim-in msg-in sc-user-row">
        <PlateOrnament />
        <div className="sc-msghead sc-userhead">
          <span className="sc-gutter">
            <UserRound size={11} aria-hidden />
            {`${t('mv.gutter.you', 'YOU')} · ${n(timeStr(msg.timestamp))}`}
          </span>
          {isQueued && <span className="stamp stamp-clay sc-end">{t('mv.stamp.queued', 'QUEUED')}</span>}
          {isSteer && <span className="stamp stamp-warn sc-end">{t('mv.stamp.steered', 'STEERED')}</span>}
        </div>
        <div className={`sc-userbody ${isSteer ? 'sc-steer-note' : ''}`} dir="auto">
          {!!msg.images?.length && (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {msg.images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt="attachment"
                  className="max-h-24 rounded-lg border border-line select-text"
                  draggable={false}
                />
              ))}
            </div>
          )}
          {msg.content}
        </div>
      </div>
    );
  }

  // ---------------- tool_result reaching the stream standalone ----------------
  if (msg.kind === 'tool_result') {
    return (
      <div className="w-full anim-in msg-in min-w-0 sc18-solo-res">
        <ResultRow result={msg} />
      </div>
    );
  }

  // ---------------- assistant text ----------------
  if (msg.role === 'assistant' && msg.kind !== 'tool_call') {
    // v11.37 — a stale / leaked `model:'error'` tag is NOT an app error. Only a
    // genuine error row (explicit isError / error role, or the legacy tag on a
    // settled, non-answer payload) mounts the calm card. Normal assistant prose
    // that merely mentions 429 / rate limit stays ordinary markdown.
    const isError = isGenuineAppError(msg);
    // v11.7 — SAFETY NET: a synthetic meta row whose dedicated card is missing
    // (or any pure known-key JSON payload) degrades to a collapsed chip instead
    // of dumping raw JSON into the conversation.
    if (!msg.streaming && !isError) {
      const metaJson = looksLikeMetaJson(msg.content);
      if (metaJson) return <JsonMetaChip content={msg.content} />;
    }
    const segs = segments ?? [{ type: 'md' as const, text: msg.content }];
    // v8.2 — engine gate lines ("[mutation gate] PASSED — …") render as
    // compact verdict chips instead of raw markdown (store untouched).
    const gate = !isError ? matchGate(msg.content) : null;
    // v11.3 — live reasoning (think_delta channel) joins any legacy parsed
    // thinking segments into ONE dedicated block; the answer markdown stays
    // 100% clean.
    const liveThink = msg.thinking ?? '';
    const legacyThink = segs
      .filter((s) => s.type === 'thinking')
      .map((s) => s.text)
      .join('\n\n');
    const thinkAll = [liveThink, legacyThink].filter(Boolean).join('\n\n');
    const mdOnly = segs.filter((s) => s.type === 'md');
    // D1 — answerStarted: the turn is streaming AND answer text exists. For
    // the v11.3+ channel the answer IS msg.content (thinking rides the
    // dedicated msg.thinking field), so this equals the contract formula
    // `(msg.content||'').trim().length > 0`; the parsed md segments make the
    // legacy in-content <thinking> tag form exact as well.
    const answerStarted = !!msg.streaming && mdOnly.some((seg) => seg.text.trim().length > 0);
    // v11.24 — no per-delta word count: the live nib / wave / beads are gone.
    // The single spinning circle lives in ChatPanel's run/timeline strip.

    const body = isError ? (
      // v11.35 — SYSTEM failures only (the AI's prose is unaffected): the real
      // machine reason + a concrete next step + retry, on one quiet hairline.
      // The boxy red .error-card and its raw text dump are gone.
      <ErrorNotice content={msg.content} onRetry={canRetry ? onRetry : undefined} />
    ) : gate ? (
      <GateVerdictChip info={gate} content={msg.content} />
    ) : (
      <>
        {/* v11.9 D1/D2 — LIVE only while the reasoning itself streams (the
            answer has not started). Once the answer streams, the block shows
            the settled "Thought for Ns" row (collapsed unless the user pinned
            it) — the ticker measures THINKING, never the whole turn. The
            engine-persisted thinkMs wins for the settled label. */}
        {thinkAll ? (
          <ThinkingBlock
            text={thinkAll}
            active={!!msg.streaming && thinkAll.trim().length > 0}
            answerStarted={answerStarted}
            thinkMs={(msg as ChatMessageWithThinkMs).thinkMs}
          />
        ) : null}
        {mdOnly.map((seg, i) => (
          <Markdown
            key={i}
            text={seg.text}
            cursor={!!msg.streaming && i === mdOnly.length - 1}
            streaming={!!msg.streaming}
          />
        ))}
      </>
    );

    return (
      <div
        className={`relative w-full anim-in msg-in min-w-0 kb-has-actions kb-ai-msg ${
          msg.streaming ? 'msg-streaming' : ''
        }`}
      >
        {/* v11.24 — NO circle in the message-row gutter. The founder's one
            spinning circle now lives INSIDE the run/timeline strip (ChatPanel),
            together with the real phase label, elapsed clock and mono tokens.
            Plain, stable text renders here — no nib/wave/beads/shimmer. */}
        <RowActions
          copied={copied}
          onCopy={() => {
            void copy(msg.content);
          }}
          onRetry={canRetry ? onRetry : undefined}
          feedbackContext={!isError ? trunc(msg.content, 120) : undefined}
          model={!isError ? msg.model : undefined}
          time={n(timeStr(msg.timestamp))}
        />
        {/* v11.8 — the "SADEEM · time" gutter + model stamp render ONLY on
            the first row of a turn group; every later row of the same turn
            keeps the info in its hover action bar instead of repeating the
            header per row. */}
        {!isError && turnStart && (
          <div className="sc-msghead">
            {/* agent-activity marker: violet (--agent) — ONLY ever used for
                agent activity; breathes while this row is streaming */}
            <span className="sc-gutter">
              <span className={`agent-dot ${msg.streaming ? 'is-live' : ''}`} aria-hidden />
              {`${t('app.name', 'SADEEM')} · ${n(timeStr(msg.timestamp))}`}
            </span>
            {msg.model && msg.model !== 'error' && (
              <span className="stamp sc-end !h-[14px] !text-[8.5px]" dir="ltr" title={msg.model}>
                {shortModel(msg.model)}
              </span>
            )}
          </div>
        )}
        {body}
        {/* v11.11 — the ONE terse completion row (duration + tokens), replaces
            the old two-chip usage row; quiet, no box (wave2-A1 rule 5). */}
        {!msg.streaming && <DoneRow msg={msg} />}
      </div>
    );
  }

  // ---------------- tool_call → v2 mini glass card (.tl2-* grammar) ----------------
  // Hooks live inside the card components — MessageViewRow stays hook-simple.
  if (msg.kind === 'tool_call') {
    return <ToolCallCard msg={msg} result={result} />;
  }
}

/** Memoized row — props are kept stable by ChatPanel (result map + stable callbacks). */
export const MessageView = memo(MessageViewRow);

export default MessageView;
