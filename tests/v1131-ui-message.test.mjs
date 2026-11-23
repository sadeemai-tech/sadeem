// ============================================================
// v11.31 — UI CAPABILITY: MESSAGE VIEW / PROOF / SESSION TIMELINE.
//
// Owns three render surfaces and locks in the v11.31 audit fixes:
//   • MessageView — HONEST copy (real clipboard write before a "Copied" flash;
//     a failure toasts, never paints a false success) on all FOUR copy buttons;
//     bilingual meta/review rows + localized tool receipt units; a clean review
//     with ZERO findings renders an honest "NO FINDINGS" header, not a blank gap.
//   • ProofRibbon — one small button, real clipboard summary + honest toast,
//     ZERO panel/gate/ledger scaffolding left in source or markup.
//   • SessionTimeline — ONE checkpoint ledger read (no duplicate load), bilingual
//     relative labels, and an honest toast when a restore fails.
//
// Source locks + real esbuild/SSR render of the real components + real store.
//   node --test --test-force-exit tests/v1131-ui-message.test.mjs
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
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

const MSG_PATH = 'src/components/MessageView.tsx';
const RIBBON_PATH = 'src/components/ProofRibbon.tsx';
const TIMELINE_PATH = 'src/components/SessionTimeline.tsx';
const strip = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
const MSG = strip(src(MSG_PATH));
const RIBBON = strip(src(RIBBON_PATH));
const TIMELINE = strip(src(TIMELINE_PATH));

// ─────────────────────────────────────────────────────────
// 1 · SOURCE — honest copy on every button
// ─────────────────────────────────────────────────────────
test('copyText awaits the REAL write and returns the ACTUAL outcome', () => {
  assert.match(MSG, /async function copyText\(text: string\): Promise<boolean>/,
    'copyText is async and typed by its real boolean outcome');
  assert.match(MSG, /navigator\.clipboard\.writeText !== 'function'/, 'guards clipboard availability');
  assert.match(MSG, /await navigator\.clipboard\.writeText\(text\)/, 'awaits the real clipboard write');
  assert.match(MSG, /await copyText\(text\)/, 'feedback hook observes the real result');
  assert.ok(!MSG.includes('void navigator.clipboard?.writeText'), 'no fire-and-forget write');
  // No copy button can flash a success it did not earn.
  assert.ok(!MSG.includes('if (copyText('), 'no old truthy-Promise check');
  assert.ok(!MSG.includes('flash();'), 'no unconditional flash left');
});

test('all FOUR copy buttons route through the honest feedback hook', () => {
  // RowActions message copy, code-block copy, tool-args copy, single-arg copy.
  assert.match(MSG, /const \{ copied, copy \} = useCopyFeedback\(\);/, 'message-row copy');
  assert.match(MSG, /const \{ copied, copy \} = useCopyFeedback\(\);[\s\S]*void copy\(code\)/, 'code-block copy');
  assert.match(MSG, /const \{ copy: copyArgs \} = useCopyFeedback\(\);/, 'tool-args copy');
  assert.match(MSG, /void copyArgs\(msg\.content\)/, 'tool-args button wired');
  assert.match(MSG, /void copy\(v\)/, 'single-argument path copy wired');
  assert.match(MSG, /notify\(t\('chat\.copyFailed', ar \? 'تعذّر النسخ' : 'Could not copy'\)\)/,
    'a failed write toasts honestly in the active language');
});

// ─────────────────────────────────────────────────────────
// 2 · SOURCE — bilingual honesty + no blank states
// ─────────────────────────────────────────────────────────
test('meta / review / receipt rows never leak English prose into an Arabic UI', () => {
  for (const key of ['mv.compaction', 'mv.meta.inspect', 'mv.findings.none', 'mv.findings.count',
    'mv.unit.hits', 'mv.unit.lines']) {
    assert.ok(MSG.includes(key), `MessageView localizes via ${key}`);
  }
  assert.ok(MSG.includes('ضغط السياق'), 'Arabic compaction label');
  assert.ok(MSG.includes('بيانات وصفية من المحرك'), 'Arabic meta-payload label');
  assert.ok(MSG.includes('لا ملاحظات'), 'Arabic zero-findings label');
  assert.ok(MSG.includes('نتائج') && MSG.includes('أسطر'), 'Arabic read receipt units');
});

test('an empty review findings card renders an honest header, not a blank gap', () => {
  const card = MSG.slice(MSG.indexOf('function FindingsCard'), MSG.indexOf('// ---------------- v6 Apex meta cards'));
  assert.ok(card.includes('findings.length === 0'), 'empty branch exists');
  assert.ok(card.includes('sc-findings-head'), 'empty branch reuses the calm head');
  assert.ok(!/if \(findings\.length === 0\) return null;/.test(card), 'no blank null return');
});

test('proof ribbon is ONE small button with no panel scaffolding in source', () => {
  assert.equal((RIBBON.match(/<button\b/g) || []).length, 1, 'exactly one control');
  for (const gone of ['pr-pop', 'pr-tally', 'pr-kind', 'pr-ink-check', 'GateGlyph', 'KindGlyph',
    'EvidenceMark', 'InkCheck', 'defaultOpen', 'popPos', 'useId', 'ShieldCheck', 'ChevronDown',
    'role="dialog"', '{open &&', 'toggleOpen(', 'copyEvidence(']) {
    assert.ok(!RIBBON.includes(gone), `no ${gone} panel/glyph remnant`);
  }
  // The working action stays byte-for-byte honest.
  assert.match(RIBBON, /const handleProofCopy = async/, 'real click handler');
  assert.match(RIBBON, /await clip\.writeText\(summary\)/, 'real clipboard write');
  assert.match(RIBBON, /notify\(ar \? 'تم نسخ ملخص الإثبات' : 'Evidence summary copied'\)/, 'honest success toast');
  assert.match(RIBBON, /if \(!proofVisible\) return null;/, 'plain chat renders nothing');
  assert.match(RIBBON, /if \(proofVisible && !prevVisible\.current\)/, 'one-shot pulse on rising edge');
  assert.match(RIBBON, /key=\{pulseGen\}/, 'one-shot pip keyed for replay');
});

test('session timeline loads checkpoints ONCE and reports failed restores', () => {
  assert.equal((TIMELINE.match(/\.cpList\(wsPath\)/g) || []).length, 1, 'one ledger read per poll');
  assert.ok(!TIMELINE.includes('onDoubleClick'), 'no double-click bypass of the confirm bubble');
  assert.match(TIMELINE, /relTimeParts/, 'relative time is composed for each language');
  assert.ok(!/function relTime\(ts: number\): string/.test(TIMELINE), 'English-only relTime is gone');
  for (const key of ['tl.rel.now', 'tl.rel.m', 'tl.rel.h', 'tl.rel.d']) {
    assert.ok(TIMELINE.includes(key), `bilingual relative label ${key}`);
  }
  assert.match(TIMELINE, /notify\(t\('tl\.restoreFailed'/, 'a failed restore is never silent');
});

// ─────────────────────────────────────────────────────────
// 3 · SSR — real components, real store, real language
// ─────────────────────────────────────────────────────────
const BUNDLE = join(ROOT, 'tests', '.v1131-ui-message.bundle.cjs');
let mod, React, renderToStaticMarkup;

before(() => {
  globalThis.window = {
    surnia: new Proxy({}, {
      get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => Promise.resolve(undefined)),
    }),
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false }),
    setInterval: () => 1, clearInterval() {},
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
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } }, configurable: true, writable: true,
  });

  esbuild.buildSync({
    stdin: {
      contents:
        "export { MessageView } from './src/components/MessageView';" +
        "export { ProofRibbon } from './src/components/ProofRibbon';" +
        "export { SessionTimeline } from './src/components/SessionTimeline';" +
        "export { useStore } from './src/store';",
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
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});
after(() => { try { unlinkSync(BUNDLE); } catch { /* gone */ } });

const h = (...a) => React.createElement(...a);
const T = 1700000000000;
const setLang = (language, numerals = 'western') =>
  mod.useStore.setState((s) => ({ settings: { ...s.settings, language, numerals } }));
const renderMsg = (msg, extra = {}) => renderToStaticMarkup(h(mod.MessageView, { msg, turnStart: true, ...extra }));

test('SSR: zero-findings review is an honest calm header in EN and AR', () => {
  const msg = { id: 'rev', role: 'assistant', kind: 'text', model: 'review-findings',
    content: '{"findings":[],"summary":"clean"}', timestamp: T };
  setLang('en');
  const en = renderMsg(msg);
  assert.match(en, /NO FINDINGS/, 'EN clean review says no findings');
  assert.ok(en.includes('clean'), 'real summary kept');
  setLang('ar', 'arabic');
  const ar = renderMsg(msg);
  assert.match(ar, /لا ملاحظات/, 'AR clean review says no findings');
  assert.ok(!ar.includes('NO FINDINGS'), 'monolingual AR');
});

test('SSR: compaction + meta chips speak the active language only', () => {
  setLang('ar', 'arabic');
  const compact = renderMsg({ id: 'c', role: 'assistant', kind: 'text', model: 'compaction',
    content: '{"before":80,"after":40}', timestamp: T });
  assert.match(compact, /ضغط السياق/, 'AR compaction label');
  assert.ok(!compact.includes('CTX compaction'), 'no English prose');
  assert.ok(compact.includes('٨٠') && compact.includes('٤٠'), 'numbers follow the digit setting');
  const meta = renderMsg({ id: 'm', role: 'assistant', kind: 'text',
    content: '{"summary":"meta"}', timestamp: T });
  assert.match(meta, /بيانات وصفية من المحرك/, 'AR meta label');
  assert.ok(!meta.includes('engine meta payload'), 'no English prose');
});

test('SSR: read receipt unit is localized; ordinary answer still renders', () => {
  setLang('ar', 'arabic');
  const call = { id: 'tc', role: 'tool', kind: 'tool_call', toolName: 'read_file',
    content: '{"path":"src/a.ts"}', timestamp: T };
  const result = { id: 'tr', role: 'tool', kind: 'tool_result', toolCallId: 'tc',
    content: 'line1\nline2\n', resultOk: true, timestamp: T + 10 };
  const html = renderMsg(call, { result });
  assert.match(html, /أسطر/, 'AR read unit');
  assert.ok(!html.includes('hits') && !html.includes('lines'), 'no English receipt unit');
  setLang('en');
  const plain = renderMsg({ id: 'a', role: 'assistant', kind: 'text',
    content: 'The answer still renders.', timestamp: T });
  assert.ok(plain.includes('The answer still renders.'), 'ordinary answer unaffected');
});

test('SSR: proof button is the ONLY proof surface (or nothing on a plain turn)', () => {
  mod.useStore.setState({
    proofVisible: true,
    proof: { status: 'proven', gates: [
      { id: 'verify', tone: 'ok', detail: 'pass', at: 1 },
      { id: 'fakes', tone: 'bad', detail: 'fail', at: 2 },
    ], updatedAt: 2, mutation: null },
  });
  const html = renderToStaticMarkup(h(mod.ProofRibbon));
  assert.equal((html.match(/<button\b/g) || []).length, 1, 'one enabled button');
  assert.match(html, /data-testid="proof-toggle"/);
  assert.ok(!html.includes('disabled='), 'button is enabled');
  assert.ok(html.includes('PROOF') && html.includes('pr-toggle-dot'), 'small chip + pip');
  for (const gone of ['pr-pop', 'pr-tally', 'pr-kind', 'role="dialog"']) {
    assert.ok(!html.includes(gone), `no ${gone} markup`);
  }
  mod.useStore.setState({ proofVisible: false });
  assert.equal(renderToStaticMarkup(h(mod.ProofRibbon)), '', 'plain turn renders no proof at all');
});

test('SSR: session timeline honours the disable switch and the localized empty state', () => {
  mod.useStore.setState({ wsPath: ROOT, settings: { ...mod.useStore.getState().settings, checkpointsEnabled: false } });
  assert.equal(renderToStaticMarkup(h(mod.SessionTimeline)), '', 'disabled → nothing');
  mod.useStore.setState((s) => ({ settings: { ...s.settings, checkpointsEnabled: true } }));
  setLang('ar', 'arabic');
  const html = renderToStaticMarkup(h(mod.SessionTimeline));
  assert.match(html, /الخط الزمني للجلسة/, 'localized region label');
  assert.match(html, /لا نقاط استعادة بعد/, 'localized empty state');
  assert.ok(!html.includes('No checkpoints yet'), 'monolingual AR');
});
