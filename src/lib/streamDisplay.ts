// streamDisplay — v11.11 (wave2-A1) PURE display helpers for the streaming
// chat surface. Presentation math only — no React, no store — so the unit
// tests (tests/v1111-stream-ui.test.mjs) drive it directly through the
// esbuild TS→JS bundle harness the other v11.1x suites use.
//
// Three jobs, all research-informed (Claude Code / Codex / OpenCode study):
//   1. GERUND PICKER — the working state is ONE quiet, STABLE gerund label
//      (Thinking / Planning / Building / Exploring / Verifying) chosen by the
//      current run phase. v11.24: the timer-driven rotation was retired — the
//      founder saw the word "tremble / dance" right after send. The static
//      "Working…" word stays retired (founder complaint #1).
//   2. ELAPSED CLOCKS — "0s / 59s / 1m 00s" for the ticking working-state
//      counter, and a terse one-decimal form for the completion row.
//   3. DRAIN RATE — how many chars of the pending engine batch the display
//      buffer advances on this animation frame: ~35% of the remaining
//      deficit per 60fps frame with TIME-BASED smoothing (frame-rate
//      independent), a hard floor for tiny deficits, and near-instant
//      catch-up once the buffer trails more than ~80 chars behind — a 20ms
//      engine batch renders with imperceptible lag, never freeze-then-pop.

// ------------------------------------------------------------
// 1 · Gerund picker
// ------------------------------------------------------------

export type GerundToken = 'thinking' | 'planning' | 'building' | 'exploring' | 'verifying';

/** Working-state phases the picker understands (superset of StreamPhase). */
export type GerundPhase =
  | 'think' // reasoning streaming / todo / delegation
  | 'work' // reads, searches, web, browser, mcp
  | 'build' // writes, edits, file creation — and answer prose streaming
  | 'run' // commands, tests
  | 'prove' // gates + proof package
  | 'plan' // plan draft
  | 'approval' // paused on the approval card (waiting on the USER)
  | 'wait'; // deltas stalled — the model is chewing

const GERUND_BY_PHASE: Record<GerundPhase, GerundToken> = {
  think: 'thinking',
  work: 'exploring',
  build: 'building',
  run: 'verifying',
  prove: 'verifying',
  plan: 'planning',
  approval: 'planning',
  wait: 'thinking',
};

/** Canonical English label per token (i18n keys ride the same tokens). */
export const GERUND_EN: Record<GerundToken, string> = {
  thinking: 'Thinking',
  planning: 'Planning',
  building: 'Building',
  exploring: 'Exploring',
  verifying: 'Verifying',
};

/** Canonical, STABLE pick for the phase — no tick, no timer, no rotation. */
export function pickGerund(phase: GerundPhase): GerundToken {
  return GERUND_BY_PHASE[phase] ?? 'thinking';
}

// ------------------------------------------------------------
// 2 · Elapsed clocks
// ------------------------------------------------------------

/** Ticking working-state clock: 0s / 59s / 1m 00s (seconds zero-padded past a minute). */
export function formatElapsedClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

/** Terse completion row: 3.2s under a minute, then the elapsed-clock form. */
export function formatDoneDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${(Math.round(s * 10) / 10).toFixed(1)}s`;
  return formatElapsedClock(ms);
}

// ------------------------------------------------------------
// 3 · Drain rate (display-buffer catch-up math)
// ------------------------------------------------------------

/** Fraction of the remaining deficit drained per 60fps frame (v11.10 used a sluggish 0.16). */
export const SMOOTH_CATCHUP = 0.55;
/** Chars/frame floor ≈ 240 chars/s at 60fps — tiny deltas still keep moving. */
export const SMOOTH_MIN_STEP = 4;
/** Buffer trailing this far behind → near-instant catch-up (no freeze-then-pop). */
export const DRAIN_BURST_CHARS = 48;
/** Longest virtual frame the time-based smoothing credits (tab-stall guard). */
export const DRAIN_MAX_FRAME_MS = 250;
const REFERENCE_FRAME_MS = 1000 / 60;

/**
 * Chars the display buffer advances THIS frame.
 * · time-based smoothing: the per-frame fraction is compounded from the real
 *   frame interval, so 60Hz / 120Hz / 45Hz displays all drain identically;
 * · deficit ≥ DRAIN_BURST_CHARS → drain everything now (imperceptible lag).
 */
export function drainStepChars(deficit: number, frameMs: number = REFERENCE_FRAME_MS): number {
  if (!(deficit > 0)) return 0;
  if (deficit >= DRAIN_BURST_CHARS) return deficit;
  const k = Math.min(
    DRAIN_MAX_FRAME_MS / REFERENCE_FRAME_MS,
    Math.max(0.25, frameMs / REFERENCE_FRAME_MS),
  );
  const rate = 1 - Math.pow(1 - SMOOTH_CATCHUP, k);
  const step = Math.max(SMOOTH_MIN_STEP * k, deficit * rate);
  return Math.min(deficit, step);
}
