// v11.19 — FINAL INTEGRATION INVARIANTS (diagnosis-only guard)
//
// Source-level invariants collected from the v11.19 change contract. These do
// NOT edit application source; they only read it and report the truth.
//   (a) no `tools.slice(0, N)` anywhere in source
//   (b) SURNIA_STREAM_CONTINUE_BUDGET default is 0
//   (c) no auto-failover on network/stall in providers.ts
//   (d) 402 message: no hardcoded provider name, no mixed EN+AR
//   (e) `cp-live-panel` present in ChatPanel and styled in CSS
//   (f) no `MessagePhaseLine` row in ChatPanel
//   (g) RunStatusLine placed after SessionTimeline
//
// Run: node --test --test-force-exit tests/v1119-integration.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/** Recursively list source files under ROOT/dir with the given extensions. */
function walk(dir, exts, out = []) {
  const abs = join(ROOT, dir);
  if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) return out;
  for (const name of readdirSync(abs)) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, exts, out);
    else if (exts.includes(extname(name))) out.push(rel);
  }
  return out;
}

/** Find regex hits on LIVE (non-comment) lines; returns file:line: text. */
function liveHits(rel, re) {
  const hits = [];
  read(rel).split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (re.test(line)) hits.push(`${rel}:${i + 1}: ${t}`);
  });
  return hits;
}

// ---------------------------------------------------------------------------
test('(a) no tools.slice(0, N) anywhere in source', () => {
  const files = ['electron', 'src', 'shared'].flatMap((d) => walk(d, ['.ts', '.tsx']));
  const re = /\btools\w*(?:\.\w+)*\.slice\(\s*0\s*,\s*\d+\s*\)/i;
  const hits = files.flatMap((f) => liveHits(f, re));
  assert.equal(
    hits.length,
    0,
    `no tools.slice(0, N) may remain anywhere in source; found ${hits.length}:\n${hits.join('\n')}`,
  );
});

// ---------------------------------------------------------------------------
test('(b) SURNIA_STREAM_CONTINUE_BUDGET default is 0', () => {
  const src = read('electron/agent/engine.ts');
  assert.match(
    src,
    /envInt\(\s*['"]SURNIA_STREAM_CONTINUE_BUDGET['"]\s*,\s*0\s*,\s*0\s*\)/,
    'engine.ts must default SURNIA_STREAM_CONTINUE_BUDGET to 0',
  );
  assert.doesNotMatch(
    src,
    /envInt\(\s*['"]SURNIA_STREAM_CONTINUE_BUDGET['"]\s*,\s*(?:8|16|25)\b/,
    'no non-zero legacy default may remain',
  );
});

// ---------------------------------------------------------------------------
test('(c) no auto-failover on network/stall in providers.ts', () => {
  const src = read('electron/agent/providers.ts');
  const start = src.indexOf("if (kind === 'network'");
  assert.ok(start >= 0, 'network/stall guard exists in the failover loop');
  const next = src.indexOf("if (kind === 'rate_limited'", start);
  const branch = src.slice(start, next > 0 ? next : start + 1200);
  assert.match(branch, /throw err/, 'network/stall error is surfaced, not swallowed');
  assert.match(branch, /not switching automatically/, 'user is told there is no automatic switch');
  assert.doesNotMatch(branch, /\bcontinue\s*;/, 'no `continue` to the next provider on network/stall');
});

// ---------------------------------------------------------------------------
test('(d) 402 message: no hardcoded provider name, no mixed EN+AR', () => {
  const src = read('electron/agent/providers.ts');
  const m = /message:\s*'([^']*402[^']*)'/.exec(src);
  assert.ok(m, '402 error message literal found in providers.ts');
  const msg = m[1];
  assert.match(msg, /this provider account has no balance/, 'provider-agnostic guidance present');
  assert.doesNotMatch(
    msg,
    /OpenRouter|OpenAI|Anthropic|Google|Mistral|DeepSeek|Groq|Together|xAI|Cerebras|Fireworks|Moonshot/i,
    'no hardcoded provider name',
  );
  assert.doesNotMatch(msg, /[\u0600-\u06FF]/, 'English base only — no mixed EN+AR in providers.ts');

  const store = read('src/store.ts');
  assert.match(store, /رصيد غير كافٍ/, 'Arabic translation lives in the renderer');
  assert.match(store, /Insufficient credits: add balance/, 'English translation lives in the renderer');
});

// ---------------------------------------------------------------------------
test('(e) the ONE live circle lives in the run strip and is styled in CSS', () => {
  // v11.24 — the old big cp-live-panel was deleted; the single circle now
  // lives inside RunStatusLine and must be styled.
  const panel = read('src/components/ChatPanel.tsx');
  assert.doesNotMatch(panel, /cp-live-panel/, 'the big standalone panel is GONE');
  assert.match(panel, /sc-strip-orbit/, 'the single circle is in the strip');
  const cssFiles = walk('src', ['.css']);
  const styled = cssFiles.filter((f) => /\.sc-strip-orbit\b/.test(read(f)));
  assert.ok(styled.length > 0, `sc-strip-orbit must be styled; checked ${cssFiles.length} CSS files`);
});

// ---------------------------------------------------------------------------
test('(f) no MessagePhaseLine row in ChatPanel', () => {
  const panel = read('src/components/ChatPanel.tsx');
  assert.doesNotMatch(
    panel,
    /<MessagePhaseLine\b/,
    'MessagePhaseLine must not be rendered as a transcript row',
  );
});

// ---------------------------------------------------------------------------
test('(g) RunStatusLine placed after SessionTimeline', () => {
  const panel = read('src/components/ChatPanel.tsx');
  const timeline = panel.indexOf('<SessionTimeline');
  const runStatus = panel.indexOf('<RunStatusLine');
  assert.ok(timeline >= 0, 'SessionTimeline is rendered');
  assert.ok(runStatus >= 0, 'RunStatusLine is rendered');
  assert.ok(
    runStatus > timeline,
    `RunStatusLine (line ${lineOf(panel, runStatus)}) must come after SessionTimeline (line ${lineOf(panel, timeline)})`,
  );
});
