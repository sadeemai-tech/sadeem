import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.18 — SIMPLE TURN IS CLEAN / EVIDENCE IS COLLAPSED.
//
// The founder's exact complaint: after a *plain conversational* reply
// ("السلام عليكم" → "وعليكم السلام، كيف أقدر أساعدك اليوم؟") the chat was
// plastered with proof-of-work chrome — PROOF strips, CLAIM AUDIT,
// "Every claim is backed by evidence", "Run & Show", "self-critique",
// "claim-audit", "receipt", "mutation" — even though NO tool ran and NO gate
// fired. On a real work turn the evidence must still be there, but behind a
// small PROOF toggle / button, not a big inline block.
//
// This is a TEST-ONLY harness (follows tests/v1116-chat-precision.test.mjs and
// tests/v1116-proof-visible.test.mjs). It bundles the REAL store + MessageView
// + ProofRibbon, drives the REAL ingest path, SSR-renders the chat subtree and
// asserts the literal founder strings are absent / present. It never patches
// application source.
//
//   node --test --test-force-exit tests/v1118-simple-turn-clean.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const BUNDLE = join(ROOT, 'tests', '.v1118-simple-turn.bundle.cjs');
const VIBE_BUNDLE = join(ROOT, 'tests', '.v1118-vibeflow.bundle.cjs');

let mod;
let vibe;
let React;
let renderToStaticMarkup;

before(() => {
  // Browser stubs installed BEFORE the store bundle loads (same posture as
  // v1114-chat-runtime / v1116-proof-visible). The store is pulled in
  // transitively by MessageView and ProofRibbon.
  const bridge = new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'then' || typeof key === 'symbol') return undefined;
        return () => Promise.resolve(undefined);
      },
    },
  );
  globalThis.window = {
    surnia: bridge,
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false }),
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  esbuild.buildSync({
    stdin: {
      contents:
        "export { useStore } from './src/store';" +
        "export { MessageView } from './src/components/MessageView';" +
        "export { ProofRibbon } from './src/components/ProofRibbon';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: BUNDLE,
    loader: { '.css': 'empty', '.svg': 'dataurl' },
    external: [
      'electron', 'react', 'react-dom', 'zustand', 'lucide-react',
      '@xterm/xterm', '@xterm/addon-fit', 'monaco-editor', '@monaco-editor/react',
    ],
  });
  // Pure engine-side emission gate (A5/A7) — bundle it separately so the test
  // can also prove the engine does not EMIT clutter for a simple turn.
  esbuild.buildSync({
    stdin: { contents: "export * from './electron/agent/vibeFlow';", resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: VIBE_BUNDLE,
    external: ['electron'],
  });
  mod = require(BUNDLE);
  vibe = require(VIBE_BUNDLE);
  React = require('react');
  // SSR reads getServerSnapshot; make it observe the live seeded state.
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  // useLayoutEffect is a DOM-scan optimization in ToolCallCard; SSR has no
  // layout, so silence React's warning without touching the source.
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
  try { unlinkSync(VIBE_BUNDLE); } catch { /* already gone */ }
});

const h = React && React.createElement;
const T = 1700000000000;

/** Fresh, sendable session (English so fallbacks are deterministic). */
function seed() {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    wsPath: ROOT,
    session: {
      id: 's1', title: 't', workspace: ROOT, messages: [],
      createdAt: T, updatedAt: T, messageCount: 0,
      totalTokens: 0, totalCostUsd: 0,
    },
    settings: {
      ...prev.settings,
      language: 'en',
      numerals: 'western',
      model: { provider: 'ollama', model: 'qwen3-coder' },
    },
    running: false,
    capabilityPanel: null,
    settingsOpen: false,
    proofVisible: false,
  });
}

const ingest = (e) => mod.useStore.getState().ingestAgentEvent(e);

const userMsg = (id, content) => ({ id, role: 'user', kind: 'text', content, timestamp: T });
const assistantMsg = (id, content) => ({ id, role: 'assistant', kind: 'text', content, timestamp: T + 1 });

function setMessages(messages) {
  const s = mod.useStore.getState();
  mod.useStore.setState({ session: { ...s.session, messages } });
}

/** SSR the chat subtree exactly as ChatPanel mounts it: every message through
 *  MessageView plus the single tail-mounted ProofRibbon. This is the surface
 *  the founder sees after a turn. */
function renderChat() {
  const msgs = mod.useStore.getState().session.messages;
  return renderToStaticMarkup(
    h(
      'div',
      { className: 'chat-stream chat-stream-v13' },
      ...msgs.map((m) => h(mod.MessageView, { key: m.id, msg: m, turnStart: true })),
      h(mod.ProofRibbon),
    ),
  );
}

/** The founder's literal clutter strings (A2's small PROOF toggle is checked
 *  separately by hook, never by the bare "PROOF" absence test). */
const CLUTTER = [
  ['PROOF', 'PROOF'],
  ['CLAIM AUDIT', 'CLAIM AUDIT'],
  ['Every claim is backed by evidence', 'Every claim is backed by evidence'],
  ['Run & Show', 'Run & Show'],
  ['self-critique', 'self-critique'],
  ['claim-audit', 'claim-audit'],
  ['receipt', 'receipt'],
  ['mutation', 'mutation'],
];

// ============================================================
// SCENARIO (a) — a plain conversational turn renders CLEAN.
// ============================================================
test('(a) simple turn: one user + one assistant, NO tool/proof events => zero clutter', () => {
  seed();
  setMessages([
    userMsg('u1', 'السلام عليكم'),
    assistantMsg('a1', 'وعليكم السلام، كيف أقدر أساعدك اليوم؟'),
  ]);

  const s = mod.useStore.getState();
  assert.equal(s.proofVisible, false, 'gate closed: no work happened');
  assert.equal(s.proof.gates.length, 0, 'no gate was fabricated');

  const out = renderChat();
  assert.ok(out.includes('السلام عليكم'), 'the user turn rendered');
  assert.ok(out.includes('وعليكم السلام'), 'the assistant turn rendered');

  for (const [label, needle] of CLUTTER) {
    // Case-insensitive: the real cards upper-case some of these
    // ("CLAIM-AUDIT", "MUTATION-CHECK"), so a literal-only check would miss
    // them. The founder's complaint is about the visible words, not casing.
    assert.ok(
      !out.toLowerCase().includes(needle.toLowerCase()),
      `"${label}" must NOT appear under a plain answer (case-insensitive)`,
    );
  }
  // structural hooks absent too
  assert.ok(!out.includes('data-testid="proof-ribbon"'), 'no PROOF toggle mounted');
  assert.ok(!out.includes('pr-tag'), 'no PROOF tag');
  assert.ok(!out.includes('claim-audit'), 'no claim-audit card');
  assert.ok(!out.includes('sc-proof-details'), 'no proof details');
});

test('(a-defensive) even a trivial claim_audit event cannot resurrect the clutter', () => {
  // The v11.18 engine used to emit claim_audit after EVERY model turn. This
  // sub-case simulates that stale behaviour: a single, trivially-supported
  // claim with a "Every claim is backed by evidence" summary. A3's
  // ClaimAuditRow must return null, so the render stays clean.
  seed();
  setMessages([
    userMsg('u1', 'السلام عليكم'),
    assistantMsg('a1', 'وعليكم السلام، كيف أقدر أساعدك اليوم؟'),
  ]);
  ingest({
    type: 'claim_audit',
    summary: 'Every claim is backed by evidence',
    unsupported: 0,
    claims: [{ claim: 'a greeting', kind: 'statement', supported: true }],
  });
  ingest({ type: 'turn_end' });

  const out = renderChat();
  for (const [label, needle] of CLUTTER) {
    assert.ok(
      !out.toLowerCase().includes(needle.toLowerCase()),
      `"${label}" still suppressed (defensive, case-insensitive)`,
    );
  }
  assert.ok(!out.includes('Every claim is backed by evidence'), 'no audit ok-banner');
});

test('engine gate: shouldEmitClaimAudit is FALSE for chat, TRUE only for real work', () => {
  assert.equal(
    vibe.shouldEmitClaimAudit({ claimsTotal: 2, writes: 0, commands: 0 }),
    false,
    'a claim-bearing chat with no writes/commands emits nothing',
  );
  assert.equal(
    vibe.shouldEmitClaimAudit({ claimsTotal: 0, writes: 3, commands: 1 }),
    false,
    'no claims => nothing to audit',
  );
  assert.equal(
    vibe.shouldEmitClaimAudit({ claimsTotal: 2, writes: 1, commands: 0 }),
    true,
    'a write + claims => audit is allowed',
  );
  assert.equal(
    vibe.shouldEmitClaimAudit({ claimsTotal: 2, writes: 0, commands: 1 }),
    true,
    'a command + claims => audit is allowed',
  );
  // defensive coercion of malformed input
  assert.equal(vibe.shouldEmitClaimAudit({ claimsTotal: NaN, writes: NaN, commands: NaN }), false);
});

// ============================================================
// SCENARIO (b) — a real work turn shows evidence, but COLLAPSED.
// ============================================================
test('(b) work turn: PROOF toggle + honest claim counts, behind buttons (not an inline block)', () => {
  seed();
  setMessages([
    userMsg('u1', 'بني لي صفحة تسجيل دخول وتحقق من operación'),
    assistantMsg('a1', 'تم بناء صفحة تسجيل الدخول وتشغيل الاختبارات بنجاح.'),
  ]);

  // Real work events the engine emits for this turn.
  ingest({ type: 'tool_start', toolCallId: 'w1', name: 'write_file', args: { path: 'src/login.ts' } });
  ingest({ type: 'tool_result', toolCallId: 'w1', ok: true, output: 'written', meta: { toolName: 'write_file' } });
  ingest({ type: 'verify_run', cmd: 'npm test', exitCode: 0, outputTail: '3 passed' });
  // Deliberately lie with the payload's `unsupported` number: the renderer must
  // derive the HONEST count from the claims array itself (1 unsupported).
  ingest({
    type: 'claim_audit',
    summary: 'audit summary',
    unsupported: 99,
    claims: [
      { claim: 'built a login page', kind: 'file', supported: true },
      { claim: 'tests pass on Mars', kind: 'test', supported: false },
    ],
  });
  ingest({ type: 'turn_end' });

  const s = mod.useStore.getState();
  assert.equal(s.proofVisible, true, 'real work + a gate opened the proof gate');

  const out = renderChat();

  // v11.26 — the founder asked to REMOVE everything proof except the small
  // PROOF button. No tally, no claim-audit row, no popover, no ledger.
  assert.ok(out.includes('data-testid="proof-ribbon"'), 'the PROOF control is mounted');
  assert.ok(out.includes('pr-tag'), 'a visible PROOF tag is present');
  assert.match(out, /<button[^>]*data-testid="proof-toggle"/, 'PROOF is a real button');
  assert.equal((out.match(/data-testid="proof-toggle"/g) || []).length, 1, 'exactly one proof button');
  assert.ok(!out.includes('pr-tally'), 'no tally button');
  assert.ok(!out.includes('CLAIM-AUDIT'), 'no claim-audit row');
  assert.ok(!out.includes('pr-pop'), 'no evidence popover');
  assert.ok(!out.includes('class="pr-check'), 'no inline gate/claim rows');
  assert.ok(!out.includes('sc-tl-out'), 'no expanded receipt detail');
});
