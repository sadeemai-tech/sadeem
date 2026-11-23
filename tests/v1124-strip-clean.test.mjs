// ============================================================
// v11.24 — STRIP CLEAN / BIG CIRCLE REMOVED (source + SSR guard).
//
// The founder's exact complaint:
//   "Right after I send, inside the chat panel there's a RING, then a strip
//    with a RING and a WAVE — remove it. Also there's text that TREMBLES /
//    dances — remove that too."
//   Follow-up: "الدائرة الكبيرة اللي بيجي جنبيها وركينج... امحيها بالكامل."
//
// Owned files only: ChatPanel.tsx, console.css, streamDisplay.ts.
// A4 owns the ONE small circle in the timeline strip (MessageView) — this
// suite asserts the BIG standalone circle is GONE from ChatPanel, not that
// circles are banned everywhere.
//
//   node --test --test-force-exit tests/v1124-strip-clean.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const chatSrc = readFileSync(join(ROOT, 'src', 'components', 'ChatPanel.tsx'), 'utf8');
const consoleCss = readFileSync(join(ROOT, 'src', 'components', 'console.css'), 'utf8');
const streamSrc = readFileSync(join(ROOT, 'src', 'lib', 'streamDisplay.ts'), 'utf8');

const BUNDLE = join(ROOT, 'tests', '.v1124-strip-clean.bundle.cjs');
let mod;
let React;
let renderToString;

before(() => {
  globalThis.window = {
    surnia: new Proxy({}, {
      get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => Promise.resolve(undefined)),
    }),
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false }),
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  esbuild.buildSync({
    stdin: {
      contents:
        "export { ChatPanel } from './src/components/ChatPanel';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
    loader: { '.css': 'empty' },
    external: ['electron', 'react', 'react-dom', 'lucide-react'],
  });
  mod = require(BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  renderToString = require('react-dom/server').renderToString;
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

function cssBody(selector) {
  const i = consoleCss.indexOf(selector);
  if (i < 0) return '';
  const open = consoleCss.indexOf('{', i);
  const close = consoleCss.indexOf('}', open);
  return consoleCss.slice(open + 1, close);
}

// ------------------------------------------------------------
// 1 — SOURCE: no ring, no wave, no trembling label, no big circle
// ------------------------------------------------------------
test('source: ring + wave decor removed from the run strip and the CSS', () => {
  for (const [name, text] of [
    ['ChatPanel.tsx', chatSrc],
    ['console.css', consoleCss],
  ]) {
    assert.ok(!text.includes('cp-live-dots'), `${name}: no breathing-dot ring`);
    assert.ok(!text.includes('cp-live-sweep'), `${name}: no sweeping hairline wave`);
  }
  assert.ok(!consoleCss.includes('cp-live-pulse'), 'console.css: ring pulse keyframes gone');
  assert.ok(!consoleCss.includes('cp-sweep-run'), 'console.css: sweep keyframes gone');
});

test('source: NO timer rotation / shimmer / keyed crossfade on the status label', () => {
  for (const [name, text] of [
    ['ChatPanel.tsx', chatSrc],
    ['streamDisplay.ts', streamSrc],
    ['console.css', consoleCss],
  ]) {
    assert.ok(!text.includes('rotateGerund'), `${name}: no rotating gerund`);
    assert.ok(!text.includes('GERUND_ROTATE_MS'), `${name}: no rotation timer`);
  }
  assert.ok(!streamSrc.includes('GERUND_ROTATION'), 'no rotation lists');
  assert.ok(!chatSrc.includes('key={token}'), 'no keyed crossfade replay');
  assert.ok(!consoleCss.includes('sc-shimmer'), 'no shimmer in console.css');

  const labelRule = cssBody('.run-strip-v13 .sc-status-label');
  assert.ok(labelRule.includes('animation: none !important'), 'the label is animation-free');
});

test('source: ONE stable bilingual label chosen from the live phase', () => {
  assert.ok(chatSrc.includes('const token = pickGerund(phase);'), 'single stable phase pick');
  assert.ok(chatSrc.includes('t(`chat.gerund.${token}`, GERUND_EN[token])'), 'bilingual gerund label kept');
  assert.equal((chatSrc.match(/className="sc-status-label"/g) || []).length, 1, 'exactly one label element');
});

test('source: the BIG standalone circle and its hooks are gone', () => {
  for (const hook of [
    'LiveThinkingPanel', 'useLivePanelVisible', 'livePanelVisible',
    'cp-live-panel', 'cp-live-glyph', 'cp-live-status', 'cp-live-clock',
  ]) {
    assert.ok(!chatSrc.includes(hook), `ChatPanel.tsx: ${hook} removed`);
  }
  // immediate run_start liveness + real data survive
  assert.ok(chatSrc.includes('<RunStatusLine />'), 'run strip still mounted on run');
  assert.ok(chatSrc.includes('phase-strip-steps'), 'real phase steps kept');
  assert.ok(chatSrc.includes('toolCount'), 'real tool count kept');
  assert.ok(chatSrc.includes('fmtTokens(totalTokens)'), 'real token count kept');
  assert.ok(chatSrc.includes('chat.run.interrupt'), 'Esc hint kept');
});

test('source: THINK circle sits in a BARE 16px socket (no square box)', () => {
  const node = cssBody('.chat-panel-root .sc18-node');
  assert.ok(node.includes('border: 0'), 'sc18-node has no border');
  assert.ok(node.includes('background: none'), 'sc18-node has no background');
  assert.ok(!node.includes('border-radius: 2px'), 'sc18-node square radius removed');

  const mark = cssBody('.chat-panel-root .sc18-phase-mark');
  assert.ok(mark.includes('border: 0'), 'phase mark has no box border');
  assert.ok(mark.includes('background: none'), 'phase mark has no stamp background');

  const orbit = cssBody('span:is(.sc18-think-orbit, .think-orbit, .think-orbit-svg)');
  assert.ok(orbit.includes('width: 16px') && orbit.includes('height: 16px'), 'orbit wrapper is 16px');
  assert.ok(orbit.includes('border: 0') && orbit.includes('background: none'), 'orbit wrapper is box-free');
  const svg = cssBody('svg:is(.sc18-think-orbit, .think-orbit, .think-orbit-svg)');
  assert.ok(svg.includes('width: 16px') && svg.includes('height: 16px'), 'orbit SVG is 16px');
  assert.ok(!consoleCss.includes('width: 12px;\n  height: 12px;\n  flex: 0 0 auto;\n  overflow: visible;\n  shape-rendering'), 'no 12px hard pin');
});

// ------------------------------------------------------------
// 2 — PURE LIB: the picker is deterministic (no tick input at all)
// ------------------------------------------------------------
test('pure lib: pickGerund is stable and rotation exports are gone', () => {
  const lib = join(ROOT, 'tests', '.v1124-strip-clean.lib.cjs');
  esbuild.buildSync({
    entryPoints: [join(ROOT, 'src', 'lib', 'streamDisplay.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: lib,
  });
  try {
    const sd = require(lib);
    for (const phase of ['think', 'work', 'build', 'run', 'prove', 'plan', 'approval', 'wait']) {
      assert.equal(sd.pickGerund(phase), sd.pickGerund(phase), `${phase}: same input → same label`);
    }
    assert.equal(typeof sd.rotateGerund, 'undefined');
    assert.equal(typeof sd.GERUND_ROTATE_MS, 'undefined');
  } finally {
    try { unlinkSync(lib); } catch { /* already gone */ }
  }
});

// ------------------------------------------------------------
// 3 — SSR: rendered running panel has no decor and no big circle
// ------------------------------------------------------------
function seed(messages) {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    wsPath: 'D:\\ws',
    session: {
      id: 's1', title: 't', workspace: 'D:\\ws', messages,
      createdAt: Date.now(), updatedAt: Date.now(), messageCount: messages.length,
      totalTokens: 0, totalCostUsd: 0,
    },
    settings: { ...prev.settings, language: 'en', model: { provider: 'custom', model: 'm' } },
    running: true,
    sessionUsage: { inputTokens: 10, outputTokens: 20, costUsd: 0.01 },
    lastTurnUsage: null,
    ctxWindow: 200000,
    pendingApproval: null,
  });
}

test('SSR running: no ring/wave, no big circle, one stable label, real stats', () => {
  const now = Date.now();
  seed([
    { id: 'u1', role: 'user', kind: 'user', content: 'do it', timestamp: now - 5000 },
    // timestamps at/after the run-start edge so the REAL tool counter is 1
    { id: 't1', role: 'assistant', kind: 'tool_call', toolName: 'read_file', toolCallId: 'c1',
      content: '{"path":"a.ts"}', timestamp: now + 5000 },
  ]);
  const html = renderToString(React.createElement(mod.ChatPanel));

  for (const hook of ['cp-live-dots', 'cp-live-sweep', 'cp-live-panel', 'cp-live-glyph']) {
    assert.ok(!html.includes(hook), `SSR: no ${hook}`);
  }
  assert.equal((html.match(/class="sc-status-label"/g) || []).length, 1, 'one stable status label');
  assert.ok(html.includes('role="status"'), 'screen-reader status kept');
  assert.ok(html.includes('phase-strip-steps'), 'real phase steps rendered');
  assert.ok(html.includes('phase-strip-stat'), 'real tool/token stats rendered');
  assert.ok(/1 tools/.test(html), 'tool count is the real number');
  assert.ok(/30 tok/.test(html), 'token count is the real number');
  assert.ok(html.includes('Esc to interrupt'), 'interrupt hint kept');
});
