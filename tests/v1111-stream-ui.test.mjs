import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// v11.11 — STREAM UI test suite (Task wave2-A1): the founder's streaming
// complaints, each pinned by a test.
//
//   1. THE 3-DOT ROWS ARE DEAD  — no "Working…" default label, no
//      sc18-workdots / kb-dots markup or CSS anywhere in the renderer. The
//      working state is ONE quiet line: SADEEM logo glyph (gentle pulse) +
//      rotating phase gerund + ticking elapsed clock, which VANISHES the
//      instant reasoning or text tokens stream (streamTailLive gate).
//   2. CONTINUOUS DRAIN — the display-buffer catch-up math lives in the pure
//      lib src/lib/streamDisplay.ts (unit-tested here): 35%/frame with
//      time-based smoothing, a char floor, and near-instant catch-up past an
//      80-char backlog — 35ms engine batches render with imperceptible lag.
//   3. THE THINK CHIP WEARS THE APP LOGO — StreamTimeline's THINK band and
//      MessageView's live thinking chip use the SADEEM brand mark, not Brain.
//   4. QUIET COMPLETION ROW — one terse duration + tokens line on settle.
//
// Harness: esbuild TS→CJS bundle of the pure lib (same posture as
// v1110-surface / v1110-endurance) + source assertions on the renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1111-streamui-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`], {
    cwd: ROOT,
    stdio: 'pipe',
  });
}

const libPath = join(tmp, 'streamDisplay.cjs');
bundle('src/lib/streamDisplay.ts', libPath);
const sd = require(libPath);

const src = (p) => readFileSync(join(ROOT, p), 'utf8');
const chatPanel = src('src/components/ChatPanel.tsx');
const messageView = src('src/components/MessageView.tsx');
const streamTimeline = src('src/components/StreamTimeline.tsx');
const composer = src('src/components/Composer.tsx');
const i18n = src('src/i18n.ts');
const chatCss = src('src/components/chat.css');

// ============================================================
// 1 · Gerund picker — phases map to the five canonical gerunds
// ============================================================
test('gerund picker maps every working-state phase to a canonical gerund', () => {
  assert.equal(sd.pickGerund('think'), 'thinking');
  assert.equal(sd.pickGerund('work'), 'exploring');
  assert.equal(sd.pickGerund('build'), 'building');
  assert.equal(sd.pickGerund('run'), 'verifying'); // commands + tests → verify
  assert.equal(sd.pickGerund('prove'), 'verifying'); // gates & proof → verify
  assert.equal(sd.pickGerund('plan'), 'planning');
  assert.equal(sd.pickGerund('approval'), 'planning'); // paused on the plan contract
  assert.equal(sd.pickGerund('wait'), 'thinking'); // stalled deltas = chewing

  // the canonical five and ONLY the five
  const tokens = new Set(Object.values(sd.GERUND_EN));
  assert.deepEqual([...tokens].sort(), ['Building', 'Exploring', 'Planning', 'Thinking', 'Verifying']);

  // v11.24 — NO rotation: ONE stable pick per phase, no timer, no trembling
  // text. The picker is deterministic: the same phase always yields the same
  // token no matter how long the run has been going.
  assert.equal(sd.pickGerund('think'), sd.pickGerund('think'), 'stable across calls');
  assert.equal(typeof sd.rotateGerund, 'undefined', 'rotating gerund retired');
  assert.equal(typeof sd.GERUND_ROTATE_MS, 'undefined', 'rotation timer retired');
});

// ============================================================
// 2 · Elapsed clocks — "0s / 59s / 1m 00s" + terse done duration
// ============================================================
test('elapsed formatter renders 0s / 59s / 1m 00s (zero-padded past a minute)', () => {
  assert.equal(sd.formatElapsedClock(0), '0s');
  assert.equal(sd.formatElapsedClock(400), '0s', 'sub-second rounds down');
  assert.equal(sd.formatElapsedClock(59000), '59s');
  assert.equal(sd.formatElapsedClock(59900), '59s');
  assert.equal(sd.formatElapsedClock(60000), '1m 00s');
  assert.equal(sd.formatElapsedClock(125000), '2m 05s');
  assert.equal(sd.formatElapsedClock(-5), '0s', 'never negative');
});

test('done formatter: one decimal under a minute, then the elapsed form', () => {
  assert.equal(sd.formatDoneDuration(3200), '3.2s');
  assert.equal(sd.formatDoneDuration(940), '0.9s');
  assert.equal(sd.formatDoneDuration(59500), '59.5s');
  assert.equal(sd.formatDoneDuration(60000), '1m 00s');
  assert.equal(sd.formatDoneDuration(0), '0.0s');
});

// ============================================================
// 3 · Drain rate — 55%/frame (v13 snappier), time-based, burst past 48 chars
// ============================================================
test('drain function reaches the target smoothing (unit math)', () => {
  assert.equal(sd.SMOOTH_CATCHUP, 0.55, 'snappier than v11.11\u2019s 0.35');
  assert.equal(sd.drainStepChars(0), 0);
  assert.equal(sd.drainStepChars(-7), 0, 'no deficit → no step');

  // 60fps reference: step = 55% of the deficit when above the floor
  const step40 = sd.drainStepChars(40);
  assert.ok(Math.abs(step40 - 22) < 0.6, `40-char deficit → ≈22 chars/frame (got ${step40})`);

  // floor: tiny deficits still advance the full remainder (never stalls)
  assert.equal(sd.drainStepChars(2), 2);
  assert.equal(sd.drainStepChars(1), 1);
  // ...and the step NEVER exceeds the deficit
  assert.ok(sd.drainStepChars(5) <= 5);

  // time-based smoothing: a 33ms frame (30Hz) drains ≈ twice the 60fps step
  const stepSlow = sd.drainStepChars(40, 33.33);
  assert.ok(
    Math.abs(stepSlow - 40 * (1 - Math.pow(0.45, 2))) < 0.8,
    `compounded rate at 30Hz (got ${stepSlow})`,
  );
  assert.ok(stepSlow > step40, 'longer frame → larger step (frame-rate independence)');

  // 120Hz displays drain HALF the per-frame step, same wall-clock speed
  const stepFast = sd.drainStepChars(40, 8.33);
  assert.ok(Math.abs(stepFast - 40 * (1 - Math.pow(0.45, 0.5))) < 0.8);
  assert.ok(stepFast < step40, 'shorter frame → smaller step');

  // burst: a backlog ≥ 48 chars drains ALL AT ONCE (imperceptible lag)
  assert.equal(sd.DRAIN_BURST_CHARS, 48);
  assert.equal(sd.drainStepChars(48), 48);
  assert.equal(sd.drainStepChars(2000), 2000, 'huge engine batch lands instantly');

  // convergence: a 47-char backlog fully drains fast (snappier than v11.11)
  let deficit = 47;
  let frames = 0;
  while (deficit > 0.5 && frames < 200) {
    deficit -= sd.drainStepChars(deficit);
    frames++;
  }
  assert.ok(deficit <= 0.5, 'fully drained');
  assert.ok(frames <= 10, `converged in ${frames} frames (≤ 10)`);
});

// ============================================================
// 4 · Source assertions — the dots / "Working…" era is GONE
// ============================================================
test('no bare "Working…" default label in the owned streaming surfaces (live panel uses "Working.")', () => {
  for (const [name, text] of [
    ['ChatPanel.tsx', chatPanel],
    ['MessageView.tsx', messageView],
    ['StreamTimeline.tsx', streamTimeline],
    ['Composer.tsx', composer],
  ]) {
    assert.ok(!text.includes('Working_OLD'), `${name} must not render the static "Working…" label`);
  }
  assert.ok(!i18n.includes("'chat.run.working'"), 'the chat.run.working i18n key is retired');
  assert.ok(i18n.includes("'chat.gerund.thinking'"), 'gerund keys shipped (EN+AR)');
  assert.ok(i18n.includes("'chat.gerund.verifying'"));
});

test('zero remnants of sc18-workdots / kb-dots anywhere in src/', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(e)) {
        const t = readFileSync(p, 'utf8');
        if (t.includes('sc18-workdots') || t.includes('kb-dots')) hits.push(p);
      }
    }
  };
  walk(join(ROOT, 'src'));
  assert.deepEqual(hits, [], `no workdots/kb-dots remnants (found: ${hits.join(', ')})`);
  assert.ok(!chatCss.includes('sc18-workdot '), 'the sc18-workdot cascade keyframe is gone');
});

// ============================================================
// 5 · The one quiet status line — logo glyph + gerund + elapsed, gated
// ============================================================
test('status line: stable gerund, ticking clock, live inside the strip', () => {
  // v11.24 — the founder wants the ONE circle + its real label/clock to STAY
  // in the strip while streaming. The old streamTailLive vanishing gate is gone.
  // v11.31 — the old streamTailLive vanishing gate was deleted; phase now
  // derives from live store state directly. Assert no stale gate survives.
  assert.ok(!/\bstreamTailLive\b/.test(chatPanel.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')),
    'the obsolete streamTailLive selector is gone from executable code (comments may mention history)');
  assert.ok(!chatPanel.includes('!streamTailLive && ('), 'the vanish-on-stream gate is REMOVED');
  assert.ok(chatPanel.includes('sc-strip-orbit'), 'the single circle lives in the strip');
  // v11.24 — the founder demanded the BIG standalone circle be removed too.
  // A4 owns the ONE small circle inside the timeline strip (MessageView).
  assert.ok(!chatPanel.includes('cp-live-glyph'), 'the big standalone circle is REMOVED');
  assert.ok(!chatPanel.includes('ChatLiveIndicator'), 'the duplicate working circle is REMOVED');
  assert.ok(!chatPanel.includes('chat-live-ring'), 'no second ring next to WORKING');
  assert.ok(!chatPanel.includes('<Logo size={12} />'), 'the app logo is GONE from the live status line');
  assert.ok(chatPanel.includes('sc-status-label'), 'gerund label element exists');
  assert.ok(chatPanel.includes('sc-status-clock'), 'elapsed clock element exists');
  assert.ok(chatPanel.includes('formatElapsedClock(now - startRef.current)'), 'ticking elapsed');
  assert.ok(chatPanel.includes('pickGerund(phase)'), 'ONE stable gerund picked by live phase');
  assert.ok(!chatPanel.includes('rotateGerund('), 'no rotating gerund timer in the renderer');
  assert.ok(!chatPanel.includes('cp-live-dots') && !chatPanel.includes('cp-live-sweep'), 'no ring / wave decor');
  assert.ok(chatPanel.includes('phaseOfTool(m.toolName)'), 'tool runs map to their REAL band phase');
  assert.ok(!chatPanel.includes('sc18-workrow'), 'the 3-dot working row JSX is gone');
  assert.ok(!chatPanel.includes('chat.run.working'));

  // CSS: calm label + NO infinite shimmer + reduced-motion static fallback
  assert.ok(chatCss.includes('@keyframes sc-status-breathe'), 'glyph breathe keyframes');
  assert.ok(chatCss.includes('@keyframes sc-shimmer'), 'shimmer keyframes may remain defined');
  assert.ok(!chatCss.includes('sc-shimmer 4s var(--ease-out) 600ms infinite'), 'no infinite shimmer sweep on the label');
  const rmAt = chatCss.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(rmAt >= 0, 'prefers-reduced-motion block exists');
  const rmBlock = chatCss.slice(rmAt, chatCss.indexOf('}', chatCss.indexOf('.sc-status-label', rmAt)));
  assert.ok(rmBlock.includes('.sc-status-label'), 'reduced-motion: the label falls back to static text');
  assert.ok(rmBlock.includes('animation: none'), 'reduced-motion freezes the sweep');
});

// ============================================================
// 6 · THINK band and reasoning head wear the SPINNING CIRCLE, not a brand logo
// ============================================================
test('THINK band + live thinking chip use the precise spinning circle, not a brand mark', () => {
  // v11.23 — the app logo beside THINK was the founder's complaint. It is gone.
  assert.ok(!streamTimeline.includes("import { Logo } from './Logo'"), 'no app logo in StreamTimeline');
  assert.ok(!streamTimeline.includes('ThinkBrand'), 'the brand wrapper is deleted');
  assert.ok(streamTimeline.includes('ThinkOrbit'), 'the spinning circle owns the THINK band');
  assert.ok(streamTimeline.includes('sc18-node-ico'), 'the node hook is preserved');
  assert.ok(!/<Brain/.test(streamTimeline), 'no Brain glyph rendered in StreamTimeline');

  // v11.22 — the founder demanded the app logo + descending line be REMOVED
  // from the thinking head and replaced by the precise spinning circle.
  assert.ok(!messageView.includes("import { Logo } from './Logo'"), 'no app logo import in MessageView');
  assert.ok(!messageView.includes('ThinkEngraving'), 'the descending-line glyph is GONE');
  assert.ok(messageView.includes('PrecisionThinkingOrbit'), 'the precise spinning circle owns the thinking head');
  assert.ok(messageView.includes('sc-think-mark'), 'the live thinking chip hook is preserved');
  assert.ok(!/<Brain/.test(messageView), 'no Brain glyph rendered in MessageView');
  assert.ok(!messageView.includes('kb-dots'), 'no 3-dot cluster in the thinking header');
});

// ============================================================
// 7 · Continuous motion — memoized blocks + lib-driven drain
// ============================================================
test('stream pipeline: drain math from the lib, memoized block components', () => {
  assert.ok(
    messageView.includes("import { drainStepChars, formatDoneDuration } from '../lib/streamDisplay'"),
    'MessageView consumes the unit-tested drain lib',
  );
  assert.ok(messageView.includes('drainStepChars(deficit, frameMs)'), 'the rAF tick uses time-based drain');
  assert.ok(messageView.includes('memo(function ThinkingBlock'), 'ThinkingBlock memoized (no re-parse storms)');
  assert.ok(messageView.includes('memo(function Markdown'), 'Markdown memoized');
  assert.ok(chatCss.includes('sc18-chunk-in 0.14s'), '140ms fade+rise chain kept');
  assert.ok(chatCss.includes('sc18-dot-pulse 1.4s'), 'the 6px write-head breathing dot kept');
});

// ============================================================
// 8 · Terse completion row — duration + tokens, one quiet line
// ============================================================
test('completion row: terse sc-done-row with duration + tokens', () => {
  assert.ok(messageView.includes('function DoneRow'), 'DoneRow component exists');
  assert.ok(messageView.includes('sc-done-row'), 'quiet one-line row class');
  assert.ok(messageView.includes('formatDoneDuration('), 'duration formatted by the lib');
  assert.ok(messageView.includes("{!msg.streaming && <DoneRow msg={msg} />}"), 'renders once the message settles');
  assert.ok(messageView.includes("usage.estimated ? '≈' : ''"), 'honest ≈ marker kept');
  assert.ok(chatCss.includes('.sc-done-row'), 'CSS shipped');
});
