// ============================================================
// v11.28 — NO REPORT CARD IN THE TRANSCRIPT.
//
// The founder showed a screenshot of the `REPORT / RUN REPORT · … ·
// PARTIAL — work kept on disk` card that still sat under the answer and said
// "صورت لك المكان اللي حكيت لك الشيء اللي إياه، ولكن لسه موجود" — he wants it
// GONE from the design (only the small PROOF button stays). The report DATA
// remains in the store (lastTaskReport / the terminal report event); A2 will
// surface it as a toast. This suite owns ONLY the visual card in MessageView.
//
// It bundles the REAL store + MessageView + ProofRibbon with esbuild, SSR
// renders a transcript seeded with a task-report message (plus the rest of
// the proof-ish synthetic family), and asserts:
//   • SOURCE: TaskReportCard + its `model === 'task-report'` dispatch + every
//     literal REPORT/RUN REPORT/PARTIAL string are deleted (no comment remnant);
//   • SSR: the seeded report payload renders NOTHING (no card, no raw JSON),
//     while a normal assistant answer and the small PROOF button still render.
//
//   node --test --test-force-exit tests/v1128-no-report-card.test.mjs
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

const MSG_PATH = 'src/components/MessageView.tsx';
const BUNDLE = join(ROOT, 'tests', '.v1128-no-report-card.bundle.cjs');
const MSG_SOURCE = readFileSync(join(ROOT, MSG_PATH), 'utf8');
const strip = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
const msgCode = strip(MSG_SOURCE);

let mod, React, renderToStaticMarkup;

before(() => {
  const bridge = new Proxy({}, {
    get(_t, k) {
      if (k === 'then' || k === 'toJSON' || typeof k === 'symbol') return undefined;
      return () => Promise.resolve(undefined);
    },
  });
  globalThis.window = {
    surnia: bridge,
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false }),
    setTimeout: () => 1, clearTimeout() {},
    innerWidth: 1280, innerHeight: 800,
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } }, configurable: true, writable: true,
  });

  esbuild.buildSync({
    stdin: {
      contents:
        "export { useStore } from './src/store';" +
        "export { MessageView } from './src/components/MessageView';" +
        "export { ProofRibbon } from './src/components/ProofRibbon';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
    loader: { '.css': 'empty', '.svg': 'dataurl' },
    external: [
      'electron', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/server', 'zustand',
      'lucide-react', '@xterm/xterm', '@xterm/addon-fit', 'monaco-editor', '@monaco-editor/react',
    ],
  });
  mod = require(BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect; // SSR: silence layout-effect warning
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

const h = (...a) => React.createElement(...a);
const T = 1700000000000;

// The literal strings the founder pointed at in the screenshot.
const REPORT_MARKUP = [
  'TaskReportCard',
  'RUN REPORT',
  'REPORT',
  'PARTIAL — work kept on disk',
  'sc-report-quiet',
  'chat.report.',
  'TOOLS USED',
  'NEXT STEPS',
  'NOT DONE',
  'stop_reason',
];

/** Seed a real work turn: the store still carries the task-report message row,
 *  but it must render nothing — the data lives in lastTaskReport / the toast. */
function seedTranscript() {
  const prev = mod.useStore.getState();
  const report = {
    outcome: 'completed',
    summary: 'Work finished — summary that must NOT appear in the transcript',
    files: ['src/secret-payload.ts'],
    commands: [{ cmd: 'npm test', ok: true }],
    howToRun: 'npm test',
    nextSteps: ['Do this next — must NOT appear'],
    notDone: ['Not this — must NOT appear'],
    toolsUsed: [{ name: 'write_file', count: 1, ok: 1, fail: 0 }],
    usage: { inputTokens: 1234, outputTokens: 567, costUsd: 0.0042 },
    partial: true,
    taskMode: 'build',
    stopReason: 'end_turn',
    durationMs: 3200,
    at: T,
  };
  mod.useStore.setState({
    wsPath: ROOT,
    running: false,
    proofVisible: true,
    capabilityPanel: null,
    settingsOpen: false,
    proof: { status: 'proven', gates: [{ id: 'verify', tone: 'ok', detail: 'exit 0', at: T }], updatedAt: T, mutation: null },
    settings: {
      ...prev.settings, language: 'en', numerals: 'western',
      model: { provider: 'custom', model: 'm' },
    },
    session: {
      id: 's1', title: 't', workspace: ROOT,
      messages: [
        { id: 'u1', role: 'user', kind: 'text', content: 'build me the thing', timestamp: T },
        { id: 'a1', role: 'assistant', kind: 'text', content: 'The normal answer that must still render.', timestamp: T + 1 },
        // the synthetic report row the store still injects
        {
          id: 'r1', role: 'assistant', kind: 'text', model: 'task-report',
          content: JSON.stringify(report), timestamp: T + 2,
        },
        // the rest of the proof-ish synthetic family must also stay gone
        ...['goal-verified', 'critic', 'receipt', 'proof', 'mutation-gate',
          'red-green', 'fake-tests', 'claim-audit', 'mutation-check'].map((m, i) => ({
          id: `p${i}`, role: 'assistant', kind: 'text', model: m,
          content: JSON.stringify({ verdict: 'PASS', summary: 'Every claim is backed by evidence' }),
          timestamp: T + 3 + i,
        })),
      ],
      createdAt: T, updatedAt: T, messageCount: 12,
      totalTokens: 0, totalCostUsd: 0,
    },
  });
  return report;
}

function renderChat() {
  const msgs = mod.useStore.getState().session.messages;
  return renderToStaticMarkup(
    h(
      'div',
      { className: 'chat-stream' },
      ...msgs.map((m) => h(mod.MessageView, { key: m.id, msg: m, turnStart: true })),
      h(mod.ProofRibbon),
    ),
  );
}

// ============================================================
// SOURCE — the card and every literal mark are deleted, not hidden.
// ============================================================
test('source: TaskReportCard component is deleted (no remnant, even in comments)', () => {
  assert.ok(!/\bTaskReportCard\b/.test(msgCode), `${MSG_PATH}: no TaskReportCard component`);
  assert.ok(!MSG_SOURCE.includes('TaskReportCard'), `${MSG_PATH}: no "TaskReportCard" string at all`);
});

test('source: no `model === task-report` dispatch branch in any form', () => {
  assert.ok(!/model\s*===\s*['"]task-report['"]/.test(msgCode), `${MSG_PATH}: no task-report dispatch branch`);
  assert.ok(!MSG_SOURCE.includes("model === 'task-report'"), `${MSG_PATH}: no literal dispatch remnant`);
});

test('source: no REPORT / RUN REPORT / PARTIAL card markup remains', () => {
  for (const needle of REPORT_MARKUP) {
    assert.ok(!MSG_SOURCE.includes(needle), `${MSG_PATH}: "${needle}" must be deleted from source`);
  }
});

test('source: proof-ish synthetic row dispatches are gone too', () => {
  for (const model of ['proof', 'claim-audit', 'mutation-check', 'mutation-gate', 'red-green', 'fake-tests']) {
    assert.ok(!new RegExp(`model\\s*===\\s*['"]${model}['"]`).test(msgCode),
      `${MSG_PATH}: no dispatch for ${model}`);
  }
});

// ============================================================
// SSR — the seeded transcript renders clean; the answer + PROOF stay.
// ============================================================
test('SSR: a seeded task-report message renders NO report card and NO raw JSON', () => {
  const report = seedTranscript();
  const out = renderChat();

  // The genuine answer and the one allowed proof control survive.
  assert.ok(out.includes('The normal answer that must still render.'), 'ordinary assistant answer still renders');
  assert.ok(out.includes('build me the thing'), 'user turn still renders');
  assert.ok(out.includes('data-testid="proof-ribbon"'), 'the small PROOF ribbon is mounted');
  assert.ok(out.includes('data-testid="proof-toggle"'), 'the small PROOF button is mounted');
  assert.equal((out.match(/data-testid="proof-toggle"/g) || []).length, 1, 'exactly one PROOF button');
  assert.ok(out.includes('pr-tag'), 'the PROOF tag is visible');

  // The founder's card strings are gone.
  for (const needle of REPORT_MARKUP) {
    assert.ok(!out.includes(needle), `SSR transcript must NOT contain "${needle}"`);
  }
  // The whole synthetic payload must not fall through to markdown either.
  for (const needle of [
    report.summary, report.files[0], report.nextSteps[0], report.notDone[0],
    '"outcome"', '"partial"', '"toolsUsed"',
  ]) {
    assert.ok(!out.includes(needle), `raw report payload leaked into the transcript: "${needle}"`);
  }
  // No proof-ish sibling resurrected either.
  for (const needle of ['Every claim is backed by evidence', 'CLAIM AUDIT', 'MUTATION CHECK', 'MUTATION GATE', 'GOAL VERIFIED']) {
    assert.ok(!out.includes(needle), `proof-ish synthetic row rendered "${needle}"`);
  }
});
