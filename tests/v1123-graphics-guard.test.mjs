// ============================================================
// v11.24 — NEW-STATE CIRCLE GUARD
// Replaces the obsolete v11.21–v11.23 guards that pinned the deleted
// "one big standalone circle + gutter orbit" design. Locks what the founder
// actually asked for on 2026-11-20. No assertions at module load.
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');

const CHAT = strip(read('src/components/ChatPanel.tsx'));
const MSG = strip(read('src/components/MessageView.tsx'));
const STREAM = strip(read('src/components/StreamTimeline.tsx'));
const COMP = strip(read('src/components/Composer.tsx'));
const CSS = [
  'src/components/console.css', 'src/components/chat.css',
  'src/components/stream-motion.css', 'src/components/chat-art.css',
].map(read).join('\n');

test('no big standalone circle / ring / wave remains', () => {
  for (const m of [
    'LiveThinkingPanel', 'cp-live-glyph', 'cp-live-panel', 'chat-live-ring',
    'ChatLiveIndicator', 'cp-live-dots', 'cp-live-sweep',
  ]) {
    assert.ok(!CHAT.includes(m), `ChatPanel still contains the removed "${m}"`);
  }
  assert.ok(!CSS.includes('@keyframes cp-live-sweep'), 'dead sweep keyframe removed');
  assert.ok(!CSS.includes('sc-shimmer 4s var(--ease-out) 600ms infinite'), 'infinite shimmer text removed');
});

test('exactly one spinning circle lives INSIDE the run/timeline strip', () => {
  const start = CHAT.indexOf('function RunStatusLine');
  assert.ok(start >= 0, 'RunStatusLine component still exists');
  const end = CHAT.indexOf('\nfunction ', start + 1);
  const region = CHAT.slice(start, end < 0 ? undefined : end);
  assert.equal((region.match(/<svg\b/g) || []).length, 1, 'exactly one inline SVG in the strip');
  assert.ok(region.includes('sc-strip-orbit'), 'strip circle hook present');
  assert.ok(region.includes('viewBox="0 0 16 16"'), 'exact 16-unit grid');
  assert.ok(region.includes('animateTransform') && region.includes('orbitStatic'),
    'equal-angle orbit with reduced-motion static end state');
  assert.ok(region.includes('formatElapsedClock') && /tok/.test(region), 'real clock + tokens in the strip');
  assert.ok(region.includes('chat.gerund.'), 'bilingual phase label in the strip');
});

test('one box-free THINK circle, no app logo', () => {
  assert.ok(STREAM.includes('ThinkOrbit'), 'the spinning circle owns THINK');
  assert.ok(!STREAM.includes('<Logo'), 'no app logo in the timeline');
  assert.ok(!STREAM.includes('ThinkBrand'), 'no brand wrapper');
  assert.ok(!STREAM.includes('is-brand'), 'no brand treatment');
});

test('reasoning head keeps ONE precise circle; trembling decor is gone', () => {
  assert.ok(MSG.includes('PrecisionThinkingOrbit'), 'reasoning circle survives');
  assert.ok(MSG.includes('viewBox="0 0 32 32"'), 'integer 32-unit grid');
  for (const gone of ['LiveWave', 'LiveNib', 'PhaseBeads', 'revealWords', 'sc-reason-word', 'CompactThinkingOrbit']) {
    assert.ok(!MSG.includes(gone), `removed decor/duplicate "${gone}" still present`);
  }
});

test('single composer context orb; no straight strip', () => {
  assert.equal((COMP.match(/<ContextLens\s/g) || []).length, 1, 'one orb beside the mic');
  assert.ok(!COMP.includes('ctx-meter'), 'the straight strip is gone');
});
