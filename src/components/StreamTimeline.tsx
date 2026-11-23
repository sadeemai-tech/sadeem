// StreamTimeline — v11.8 THE STREAM AS A TIMELINE (fundamental, not cosmetic).
//
// The old transcript was a flat list of rows: tool cards stacked one after
// another, narration interleaved, gates printed as raw text lines. That
// answers "what happened" — it does not answer "WHAT PHASE IS THE AGENT IN
// and what did each phase contribute". This module restructures the stream
// into PHASE BANDS, the way Claude Code / Codex present agentic work:
//
//   THINK  (violet, ONE SPINNING CIRCLE — v11.23: the founder demanded the APP
//                               LOGO beside THINK be REMOVED and REPLACED by
//                               the orbiting ring; no brand mark, no Brain.
//                               v11.24: the SECOND circle — PHASE_MARKS.think
//                               rendered inside the phase-stamp square — is
//                               removed entirely; the single orbit is kept at
//                               sc18-node-ico, enlarged 12->16px, box-free.)
//   WORK   (read-teal, Search) — reads, searches, web, browser, mcp
//   BUILD  (clay, PenLine)    — writes, edits, file creation, image generation
//   RUN    (gold, Terminal)   — commands, tests, debug
//   PROVE  (sage, Shield)     — gates: mutation, red→green, fake-tests,
//                                critic, proof package, false-done
//
// v11.8 band grammar (.sc18-band* — defined in chat.css): the heavy boxed
// card chrome is GONE. Each band is a slim left TIME-RAIL — a 2px vertical
// line with one phase-colored node dot — plus a quiet inline header row
// (caps phase word + localized label + duration + item count, 11px --faint),
// and the MessageView cards beneath WITHOUT an enclosing border box. The
// band reads as a timeline flowing down the page, not nested boxes. The
// live band breathes softly on its node dot — no glows, no scan bars.
import React from 'react';
// v11.11 (wave3-A2) — the band node glyphs SYNC with the per-tool family
// icons (MessageView TOOL_ICONS / lib/toolGrouping): WORK wears FileText —
// the read_file family glyph — instead of SearchCode; BUILD stays PenLine
// (write/edit family), RUN Terminal (bash family), PROVE ShieldCheck.
import { FileText, PenLine, ShieldCheck, Terminal } from 'lucide-react';
import type { ChatMessage } from '../../shared/types';
// v11.23 (founder, furious) — the THINK node glyph is now the SAME precise
// spinning circle as the band-head stamp: PHASE_MARKS.think rings plus an
// equal-angle orbiting node and a 12-o'clock tick. The APP LOGO is GONE —
// no import, no violet brand-halo class — a circle sits where it used to be.
// v11.24 — THINK now wears EXACTLY ONE circle. PHASE_MARKS.think is the single
// geometry source, consumed ONLY by ThinkOrbit; the old second copy mounted in
// the sc18-phase-mark square is gone (not hidden, not commented).

// ----------------------------------------------------------
// Phase classification — tool name → band
// (v11.11 wave3-A2: the per-tool FAMILY — write/edit/read/bash/browser/
//  mcp — lives in lib/toolGrouping.ts and drives the card skins; this map
//  stays the phase grammar. toolFamilyOf agrees with TOOL_PHASE: write/
//  edit families are BUILD, read/bash/browser/mcp are WORK or RUN, think
//  family is THINK.)
// ----------------------------------------------------------

export type StreamPhase = 'think' | 'work' | 'build' | 'run' | 'prove';

const TOOL_PHASE: Record<string, StreamPhase> = {
  // work — perception
  read_file: 'work',
  list_dir: 'work',
  search_files: 'work',
  code_search: 'work',
  web_search: 'work',
  search_web: 'work',
  web_fetch: 'work',
  browser_navigate: 'work',
  browser_snapshot: 'work',
  browser_click: 'work',
  browser_type: 'work',
  browser_read: 'work',
  browser_screenshot: 'work',
  browser_eval: 'work',
  browser_close: 'work',
  // build — mutation
  write_file: 'build',
  edit_file: 'build',
  image_generate: 'build',
  worktree_create: 'build',
  worktree_remove: 'build',
  // run — execution
  run_command: 'run',
  run_background: 'run',
  process_output: 'run',
  stop_process: 'run',
  test_run: 'run',
  lint_check: 'run',
  debug_start: 'run',
  debug_state: 'run',
  debug_eval: 'run',
  debug_step: 'run',
  debug_stop: 'run',
  // think — meta
  todo_write: 'think',
  task: 'think',
  ask_user: 'think',
  use_skill: 'think',
};

/**
 * D3 — single grammar for PROVE-row detection. The engine appends synthetic
 * meta rows whose `model` carries the payload kind (verify · critic · proof ·
 * mutation-gate · red-green · fake-tests · taint · …). Exported so ChatPanel's
 * run-phase strip (deriveRunPhases) classifies with THE SAME membership list
 * the bands use — meta/gate cards land in PROVE bands, never THINK.
 */
export const PROVE_ROW_MODELS: ReadonlySet<string> = new Set([
  'verify',
  'review-findings',
  // v11.11 (A4-CLOSURE) — the GUARANTEED completion report is terminal
  // evidence, exactly like the proof cards: it must land in a PROVE band
  // (never THINK narration), including on abort/error endings.
  'task-report',
]);

/** Assistant rows that carry gate/proof payloads are PROVE material. */
const GATE_ROW_TEXT = /^\s*\[(mutation gate|red→green|regression|fake-test gate|claim audit|critic|proof|false-done|goal verifier|budget|surnia agency gate)/i;

export function phaseOfTool(name?: string): StreamPhase {
  if (!name) return 'work';
  if (name.startsWith('mcp__')) return 'work';
  return TOOL_PHASE[name] ?? 'work';
}

/**
 * Assistant narration → THINK, unless it IS a gate/proof row: a synthetic
 * meta row (msg.model in PROVE_ROW_MODELS) or a text-prefix gate line
 * ("[mutation gate] PASSED — …"). Both grammars stay live.
 */
export function phaseOfAssistant(text: string, model?: string): StreamPhase {
  if (model && PROVE_ROW_MODELS.has(model)) return 'prove';
  return GATE_ROW_TEXT.test(text) ? 'prove' : 'think';
}

interface Band {
  phase: StreamPhase;
  /** message ids belonging to the band, in stream order */
  ids: string[];
  /** user rows: own band, closed to later narration (ChatPanel renders it
   *  bare — the compact right-aligned card never wears phase chrome). */
  user?: boolean;
}

/**
 * Group a message list into phase bands. Tool rows cluster by their phase;
 * narration opens a think band; gate-ish system lines open a prove band.
 * A user row always opens its own band and CLOSES it — the assistant text
 * that follows starts a fresh band instead of joining "you". The result is
 * deterministic and stable across re-renders (ids only).
 */
export function groupStreamBands(msgs: ChatMessage[]): Band[] {
  const bands: Band[] = [];
  const last = (): Band | null => (bands.length ? bands[bands.length - 1] : null);
  for (const m of msgs) {
    let phase: StreamPhase | null = null;
    if (m.kind === 'tool_call' || m.kind === 'tool_result') phase = m.kind === 'tool_result' ? null : phaseOfTool(m.toolName);
    else if (m.role === 'assistant') phase = phaseOfAssistant(m.content, m.model);
    else if (m.role === 'user') phase = null; // user rows break the stream — their own row
    // tool_result rows join the band their tool_call opened (toolCallId is
    // already consumed by MessageView's result lookup when the call row is
    // in the visible window — see ChatPanel). D4: result rows with NO visible
    // call row (e.g. the render window cutting mid-turn) now render as the
    // .sc18-solo-res row instead of being dropped with the band.
    if (m.kind === 'tool_result') {
      const b = last();
      if (b) b.ids.push(m.id);
      else bands.push({ phase: 'work', ids: [m.id] });
      continue;
    }
    if (phase === null) {
      bands.push({ phase: 'think', ids: [m.id], user: m.role === 'user' }); // user rows: own band
      continue;
    }
    const b = last();
    if (b && b.phase === phase && !b.user) b.ids.push(m.id);
    else bands.push({ phase, ids: [m.id] });
  }
  return bands;
}

// ------------------------------------------------------------
// Band chrome — the v11.8 time-rail
// ------------------------------------------------------------

interface BandMeta {
  icon: BandIcon;
  ar: string;
  en: string;
  cssVar: string;
}

/** Band glyphs accept lucide props. (A plain function signature —
 *  ForwardRefExoticComponent lucide icons carry propTypes whose `size`
 *  validator accepts string, so ComponentType rejects them.) ThinkOrbit
 *  accepts this shape too; it ignores strokeWidth and takes `live` instead. */
type BandIcon = (props: { size?: number; strokeWidth?: number }) => React.ReactNode;

const BAND_META: Record<StreamPhase, BandMeta> = {
  think: { icon: ThinkOrbit, ar: 'تفكير', en: 'THINK', cssVar: 'var(--v-think)' },
  // wave3-A2 — node icon synced to the READ family glyph (FileText), same
  // cool-steel --v-read the read cards wear
  work: { icon: FileText, ar: 'فحص', en: 'WORK', cssVar: 'var(--v-read)' },
  build: { icon: PenLine, ar: 'بناء', en: 'BUILD', cssVar: 'var(--v-edit)' },
  run: { icon: Terminal, ar: 'تشغيل', en: 'RUN', cssVar: 'var(--v-run)' },
  prove: { icon: ShieldCheck, ar: 'إثبات', en: 'PROVE', cssVar: 'var(--ok)' },
};

/**
 * Original phase monograms — a distinct hand-drawn mark per band, drawn with
 * token hairlines inside the 1px stamp square (printer's-mark grammar shared
 * with MessageView's mode stamps). Decorative only: the caps word is the real
 * label, so meaning never rides on the glyph alone.
 *
 * v11.24 — `think` is now consumed ONLY by ThinkOrbit (the single rail circle).
 * It is NOT mounted in the phase-stamp square any more, so THINK has one ring,
 * not two. The other bands keep their monogram in the stamp as before.
 */
const PHASE_MARKS: Record<StreamPhase, React.ReactNode> = {
  // v11.23 — the two concentric rings are the geometry source for ThinkOrbit
  // (the node glyph): snapped to integer radii on the 12-unit stamp grid so
  // the single circle obeys the same precise, 1px-currentColor craft grammar.
  think: (
    <>
      <circle cx="6" cy="6" r="5" />
      <circle cx="6" cy="6" r="2" />
    </>
  ),
  work: (
    <>
      <path d="M1.6 4V1.6H4M8 1.6h2.4V4M10.4 8v2.4H8M4 10.4H1.6V8" />
      <circle cx="6" cy="6" r="1.5" />
    </>
  ),
  // an isoceles drafting set-square centred on x=6 — the old baseline ran
  // x4.5..10.5 (centre 7.5), a visible 1.5px drift off the 12px stamp plate.
  build: (
    <>
      <path d="M6 1.8 2.4 10.2h7.2Z" />
      <path d="M3 10.5h6" />
    </>
  ),
  run: (
    <>
      <path d="M2.4 3.4 5 6l-2.6 2.6" />
      <path d="M6.4 8.6h3.2" />
    </>
  ),
  prove: (
    <>
      <path d="M6 1.5 10 3v3.2c0 2.4-1.6 3.8-4 4.8-2.4-1-4-2.4-4-4.8V3Z" />
      <path d="m4.2 6 1.3 1.3 2.4-2.6" />
    </>
  ),
};

/**
 * v11.23 — the APP LOGO is GONE from the THINK node. What sits there now is
 * the band-head circle brought to life: PHASE_MARKS.think supplies the exact
 * same two concentric rings (r5 + r2, integer, 1px currentColor) on the
 * 12-unit grid; an equal-angle node (ring r2 + solid core r1) orbits the
 * centre, and a hairline tick marks exact 12 o'clock. No blur/glow/gradient.
 *
 * Motion runs ONLY while the band streams, and only when the host allows it:
 * `prefers-reduced-motion: reduce` OR the in-app `html.reduce-motion` switch
 * removes the rotation entirely, parking the node at exact 12 o'clock.
 */
function thinkMotionAllowed(): boolean {
  if (typeof window === 'undefined') return true;
  const mqOff = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const appOff = typeof document !== 'undefined' && !!document.documentElement.classList.contains('reduce-motion');
  return !mqOff && !appOff;
}

function useThinkMotion(): boolean {
  const [allowed, setAllowed] = React.useState(thinkMotionAllowed);
  React.useEffect(() => {
    const sync = () => setAllowed(thinkMotionAllowed());
    sync();
    const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', sync);
    // the in-app switch toggles a class on <html>, not a media query — watch it
    // so a live orbit freezes the moment the founder turns motion off.
    const mo = typeof MutationObserver !== 'undefined' && typeof document !== 'undefined'
      ? new MutationObserver(sync)
      : null;
    if (mo) mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      if (mq && typeof mq.removeEventListener === 'function') mq.removeEventListener('change', sync);
      if (mo) mo.disconnect();
    };
  }, []);
  return allowed;
}

function ThinkOrbit({ size = 12, live = false }: {
  size?: number;
  strokeWidth?: number;
  live?: boolean;
}): React.ReactElement {
  const motionAllowed = useThinkMotion();
  const animate = live && motionAllowed;
  return (
    <svg
      className="sc18-think-orbit"
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      focusable="false"
      aria-hidden="true"
      /* v11.24 — console.css pins .sc18-think-orbit to 12px; the inline size
         is the single source of truth so the enlarged ring actually renders.
         The 12-unit viewBox + integer radii stay untouched (1px non-scaling
         strokes come from CSS), so 12px -> 16px is a pure, clean scale-up. */
      style={{ width: size, height: size, color: 'var(--acc)' }}
    >
      {/* the band stamp's own geometry — reused, never a logo */}
      <g stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        {PHASE_MARKS.think}
        {/* exact 12-o'clock tick, crossing the outer ring top at y=1 */}
        <path d="M6 1v2" />
      </g>
      {/* equal-angle orbiting node — ring r2 + solid core r1, parked atop */}
      <g>
        {animate && (
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 6 6"
            to="360 6 6"
            dur="2.2s"
            repeatCount="indefinite"
          />
        )}
        <circle cx="6" cy="3" r="2" stroke="currentColor" strokeWidth="1" />
        <circle cx="6" cy="3" r="1" fill="currentColor" />
      </g>
    </svg>
  );
}

/** "512ms" under a second, "3.2s" above — quiet band duration chip. */
function fmtBandDur(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Exact ring radius/circumference — mirrors MessageView's single source of
 *  truth (r=5 in a 14×14 viewBox; dash array MUST equal 2πr, never rounded). */
export const RING_RADIUS = 5;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * A small progress ring for plan/checkpoint/build bands — filled ONLY from
 * real completed/total step data passed by the caller (never a guessed value).
 * The arc length is the exact 2πr circumference (r=5 → 31.41592653589793) and
 * the fill offset is derived straight from done/total. Full float precision —
 * no `.toFixed(2)` hairline seam at 100%. Static, no animation of its own
 * (the shared .ts-ring CSS owns the gentle dashoffset fill + motion guards).
 */
function PhaseRing({ done, total }: { done: number; total: number }) {
  const circ = RING_CIRCUMFERENCE;
  const value = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  return (
    <span className="ts-ring sc18-phase-ring" style={{ width: 13, height: 13 }} aria-hidden>
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

/** 1s tick while a band streams — drives the live duration chip. */
function useNowTicker(enabled: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [enabled]);
  return now;
}

/**
 * v11.8 — one band of the agent timeline: left time-rail (2px line + phase
 * node dot), quiet caps header (phase word · label · duration · count), then
 * the MessageView cards with NO enclosing box. `startAt`/`endAt`/`count` come
 * from ChatPanel (real message timestamps). A live band ticks its duration
 * every second and breathes on the node dot.
 */
export function StreamBandShell({
  phase,
  live,
  label,
  children,
  startAt,
  endAt,
  count,
  progress,
}: {
  phase: StreamPhase;
  live: boolean;
  label: string;
  children: React.ReactNode;
  /** first row timestamp of the band — anchors the duration chip */
  startAt?: number;
  /** last row timestamp (closed bands only; live bands tick to now) */
  endAt?: number;
  /** number of visible items inside the band */
  count?: number;
  /** real completed/total steps — when supplied, a small ring fills in the
   *  band head. Absent = no ring (never a fabricated percentage). */
  progress?: { done: number; total: number };
}): React.ReactElement {
  const meta = BAND_META[phase];
  const now = useNowTicker(live && startAt !== undefined);
  const durMs = live && startAt !== undefined ? Math.max(0, now - startAt) : startAt !== undefined && endAt !== undefined ? Math.max(0, endAt - startAt) : null;
  const showDur = durMs !== null && (live || durMs >= 400);
  return (
    <section
      className={`sc18-band ${live ? 'is-live' : ''}`}
      data-phase={phase}
      style={{ '--band-c': meta.cssVar } as React.CSSProperties}
      aria-label={`${meta.en} — ${label}`}
    >
      <span className="sc18-rail" aria-hidden>
        {/* v11.24 — the THINK circle is the ONLY glyph on this rail and must sit
            CLEAN. The base stylesheet gives .sc18-node a visible stamp square
            (console.css:370-377: 11px, 1px border, 2px radius, --bg2 fill;
            chat.css:2704-2716: 13px pill + inset ring). Neutralise that box in
            markup for THINK only so the enlarged orbit is never framed. */}
        <span
          className="sc18-node"
          style={phase === 'think' ? {
            border: 'none',
            background: 'none',
            boxShadow: 'none',
            borderRadius: 0,
          } : undefined}
        >
          <span className="sc18-node-ico" aria-hidden>
            {phase === 'think' ? (
              <ThinkOrbit size={16} live={live} />
            ) : (
              <meta.icon size={9} strokeWidth={1.8} />
            )}
          </span>
        </span>
      </span>
      <div className="sc18-band-main">
        <div className="sc18-band-head">
          {/* A distinct phase stamp — tinted micro-node + hairline chip —
              so the current agent phase reads at a glance, not as bare text. */}
          <span className="sc18-phase-stamp sc-monogram-stamp" dir="ltr">
            {/* v11.24 — THINK wears exactly ONE circle: the spinning orbit on
                the rail. The former SECOND copy (PHASE_MARKS.think's r5+r2
                rings inside this stamped square) is deleted, not hidden. Only
                the non-think bands keep their monogram. A hook-only marker
                keeps the sc18-phase-mark contract for SSR consumers without
                drawing anything — no square, no duplicate ring. */}
            {phase === 'think' ? (
              <span data-phase-mark="sc18-phase-mark" aria-hidden />
            ) : (
              <span className="sc18-phase-mark" aria-hidden>
                <svg viewBox="0 0 12 12" focusable="false" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  {PHASE_MARKS[phase]}
                </svg>
              </span>
            )}
            <span className="sc18-band-word">{meta.en}</span>
          </span>
          <span className="sc18-band-label" dir="auto">
            {label}
          </span>
          {progress && <PhaseRing done={progress.done} total={progress.total} />}
          <span className="sc18-band-meta tnum" dir="ltr">
            {showDur && durMs !== null && <span>{fmtBandDur(durMs)}</span>}
            {typeof count === 'number' && count > 0 && (
              <span>
                {showDur ? ' · ' : ''}
                {count}
              </span>
            )}
          </span>
        </div>
        <div className="sc18-band-items">{children}</div>
      </div>
    </section>
  );
}

export { BAND_META };
