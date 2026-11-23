// ============================================================
// v11.38 — SIGNATURE FEATURES (real-data proof, not marketing)
//
// Drives the three SADEEM-owned instruments with data written by the
// app's OWN durable writers:
//   • journal.ts  → a real JSONL run journal (header/tool/memory/finish)
//   • traces.ts   → a real JSONL trace (tool_call argsPreview / chars)
//   • dna.ts      → real mergeExtraction + saveDNA + recordFeedback reads
//   • tool-defs.ts→ the real CORE_DEFS inventory (145 tools)
// then renders the new SignaturePanel through react-dom/server in EN + AR.
//
//   node --test --test-force-exit tests/v1138-signature.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

const TMP = join(tmpdir(), 'sadeem-v1138-signature');
// Fresh durable stores on EVERY run: a previous run's dna.json must never
// inflate the repetition count this test is measuring.
rmSync(TMP, { recursive: true, force: true });
const ENGINE = join(TMP, 'engine');
const UD = join(TMP, 'userData');
const WS = join(TMP, 'ws');
const BUNDLE = join(ENGINE, 'signature.cjs');
const UI_BUNDLE = join(ROOT, 'tests', '.v1138-signature-ui.cjs');
mkdirSync(join(ENGINE, 'node_modules', 'electron'), { recursive: true });
mkdirSync(UD, { recursive: true });
mkdirSync(join(UD, 'sessions'), { recursive: true });
mkdirSync(WS, { recursive: true });

// The SAME electron stub posture the v1131 full-smoke harness uses.
writeFileSync(join(ENGINE, 'node_modules', 'electron', 'package.json'),
  JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(ENGINE, 'node_modules', 'electron', 'index.js'), `
const UD = ${JSON.stringify(UD)};
class StubWC { on(){} send(){} }
class StubBW { constructor(){ this.webContents = new StubWC(); } static getAllWindows(){ return []; } }
module.exports = {
  app: { getPath: () => UD, isReady: () => true, whenReady: async () => {}, on(){}, once(){}, quit(){}, setName(){}, setPath(){} },
  ipcMain: { handle(){}, on(){}, removeAllListeners(){} },
  BrowserWindow: StubBW, WebContents: StubWC,
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder(){} },
  Notification: { isSupported: () => false }, clipboard: { readText: () => '', writeText(){} },
  dialog: { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }) },
  screen: {}, nativeImage: { createFromBuffer: () => ({ toDataURL: () => '' }) },
};`);

let mod, ui, React, renderToStaticMarkup;
let real; // real data snapshots captured in before()

const T0 = 1_700_000_000_000;
const PATTERN_TEXT = 'Prefer incremental edits over full rewrites in big files';
const SESSION = {
  id: 's-1138', title: 'Signature proof', workspace: WS,
  messages: [
    { id: 'u1', role: 'user', kind: 'text', content: 'find the signature feature tests', timestamp: T0 },
    { id: 'a1', role: 'assistant', kind: 'text', thinking: 'I will search first.', content: 'Searching now.', timestamp: T0 + 100 },
    { id: 'c1', role: 'tool', kind: 'tool_call', toolName: 'search_files', toolCallId: 'call-1',
      content: '{"query":"signature","path":"D:/ws"}', timestamp: T0 + 200 },
    { id: 'r1', role: 'tool', kind: 'tool_result', toolCallId: 'call-1', toolName: 'search_files',
      content: 'tests/v1138-signature.test.mjs:1:real search hit', resultOk: true, timestamp: T0 + 300 },
    { id: 'c2', role: 'tool', kind: 'tool_call', toolName: 'read_file', toolCallId: 'call-2',
      content: '{"path":"D:/ws/a.ts"}', timestamp: T0 + 400 },
    { id: 'r2', role: 'tool', kind: 'tool_result', toolCallId: 'call-2', toolName: 'read_file',
      content: 'const a = 1;', resultOk: true, timestamp: T0 + 500 },
  ],
  createdAt: T0, updatedAt: T0 + 500, messageCount: 6,
};
writeFileSync(join(UD, 'sessions', 's-1138.json'), JSON.stringify(SESSION));

const stubPlugin = {
  name: 'sadeem-v1138-stubs',
  setup(build) {
    build.onResolve({ filter: /\?worker$/ }, () => ({ path: 'worker', namespace: 'ssm' }));
    build.onResolve({ filter: /(^|\/)lib\/monaco$/ }, () => ({ path: 'lib-monaco', namespace: 'ssm' }));
    build.onResolve({ filter: /^@monaco-editor\/react$/ }, () => ({ path: 'monaco-react', namespace: 'ssm' }));
    build.onResolve({ filter: /^lottie-web$/ }, () => ({ path: 'lottie', namespace: 'ssm' }));
    build.onResolve({ filter: /^qrcode$/ }, () => ({ path: 'qrcode', namespace: 'ssm' }));
    build.onLoad({ filter: /.*/, namespace: 'ssm' }, (a) => {
      const contents =
        a.path === 'worker' ? 'export default class SSMWorker {}'
        : a.path === 'lib-monaco'
          ? 'export const monaco = { editor: { defineTheme(){}, createModel(){}, createDiffEditor(){} } };' +
            'export const monacoThemeFor = () => "surnia-dark"; export const languageForPath = () => "plaintext";'
        : a.path === 'monaco-react'
          ? 'const Nil = () => null; export const Editor = Nil; export const DiffEditor = Nil;' +
            'export const loader = { config(){}, init(){ return Promise.resolve({}); } };'
        : a.path === 'lottie'
          ? 'export const loadAnimation = () => ({ destroy(){}, play(){}, stop(){}, goToAndStop(){} }); export default { loadAnimation };'
        : a.path === 'qrcode'
          ? 'export const toDataURL = () => Promise.resolve("data:image/png;base64,"); export const toString = () => Promise.resolve(""); export default { toDataURL, toString };'
          : 'export default null;';
      return { contents, loader: 'js' };
    });
  },
};
const EXTERNALS = ['electron', 'react', 'react-dom', 'zustand', 'lucide-react', '@xterm/xterm', '@xterm/addon-fit'];

function installBrowserStubs() {
  const bridge = new Proxy({}, {
    get(_t, key) {
      if (key === 'then' || key === 'toJSON' || typeof key === 'symbol') return undefined;
      return (..._args) => Promise.resolve(undefined);
    },
  });
  const el = () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    appendChild() {}, removeChild() {}, setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, focus() {}, remove() {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
    querySelector: () => null, querySelectorAll: () => [],
  });
  const mq = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.self = globalThis;
  globalThis.window = {
    surnia: bridge, kodex: bridge,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    matchMedia: mq,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    location: { href: 'http://localhost/', reload() {} },
    navigator: { userAgent: 'node-ssr', clipboard: { writeText: () => Promise.resolve() } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    confirm: () => true, alert() {}, prompt: () => null,
  };
  globalThis.document = {
    documentElement: el(), body: el(), head: el(),
    createElement: el, createElementNS: el, createTextNode: () => ({}),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, hidden: false, visibilityState: 'visible',
  };
  const def = (n, v) => Object.defineProperty(globalThis, n, { value: v, configurable: true, writable: true });
  def('localStorage', globalThis.window.localStorage);
  def('sessionStorage', globalThis.window.sessionStorage);
  def('matchMedia', mq);
  def('navigator', globalThis.window.navigator);
  def('location', globalThis.window.location);
  def('requestAnimationFrame', globalThis.window.requestAnimationFrame);
  def('cancelAnimationFrame', globalThis.window.cancelAnimationFrame);
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
}

before(async () => {
  // ---- backend: real writers + the pure signature core in one CJS bundle ----
  await esbuild.build({
    stdin: {
      contents:
        "export { buildTrajectory, autopsyDNA, compass, toolRoutingGraph, promptVisibleIds, AUTOPSY_PROMPT_RULE, SIGNATURE_FEATURES } from './electron/agent/signatureFeatures';" +
        "export { CORE_DEFS } from './electron/agent/tool-defs';" +
        "export { startRunJournal, journalEvent, journalMemoryFact, finishRunJournal, flushJournal, readJournal } from './electron/agent/journal';" +
        "export { TraceRecorder } from './electron/agent/traces';" +
        "export { mergeExtraction, saveDNA, loadDNA, recordFeedback, renderDNAPrompt } from './electron/agent/dna';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
    loader: { '.css': 'empty', '.svg': 'empty' },
    external: ['electron'], logLevel: 'silent',
  });
  mod = require(BUNDLE);

  // ---- a REAL journal written by journal.ts ----
  const journalFile = mod.startRunJournal('s-1138', 'Signature proof', WS, UD);
  assert.ok(journalFile && existsSync(journalFile), 'journal.ts wrote a real journal');
  mod.journalEvent(journalFile, { type: 'tool', name: 'search_files', ok: true, ms: 12 });
  mod.journalEvent(journalFile, { type: 'tool', name: 'read_file', ok: true, ms: 7 });
  mod.journalMemoryFact(journalFile, {
    decisions: [PATTERN_TEXT], filesTouched: ['src/a.ts'], sessionId: 's-1138',
  });
  mod.journalEvent(journalFile, { type: 'task_report', outcome: 'complete', files: 1, commands: 0, summary: 'found it' });
  mod.finishRunJournal(journalFile, 'completed', 'done');
  await mod.flushJournal(journalFile);
  const journalEvents = mod.readJournal(journalFile, 100);

  // ---- a REAL trace written by traces.ts ----
  const rec = new mod.TraceRecorder('s-1138', WS, 'Signature proof');
  rec.step({ t: 1, kind: 'tool_call', name: 'search_files', argsPreview: '{"query":"signature"}' });
  rec.step({ t: 2, kind: 'tool_result', name: 'search_files', ok: true, chars: 123 });
  rec.step({ t: 3, kind: 'tool_call', name: 'read_file', argsPreview: '{"path":"D:/ws/a.ts"}' });
  rec.step({ t: 4, kind: 'tool_result', name: 'read_file', ok: true, chars: 11 });
  rec.finish({ ok: true, turns: 2, tools: 2 });
  await rec.flush();
  const traceSteps = readFileSync(rec.path(), 'utf8').trim().split('\n')
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((x) => x && typeof x.kind === 'string');

  // ---- REAL DNA written by dna.ts ----
  const first = mod.mergeExtraction(mod.loadDNA(), {
    profile_additions: { expertise: ['typescript'], languages: ['ar', 'en'] },
    patterns_additions: [{ kind: 'workflow', text: PATTERN_TEXT }],
  });
  mod.saveDNA(first.dna);
  await mod.recordFeedback('preference', PATTERN_TEXT, 'user correction');
  const second = mod.mergeExtraction(mod.loadDNA(), {
    patterns_additions: [{ kind: 'workflow', text: PATTERN_TEXT }],
  });
  mod.saveDNA(second.dna);
  const dna = mod.loadDNA();

  real = {
    journalFile, journalEvents, traceSteps, dna,
    session: JSON.parse(readFileSync(join(UD, 'sessions', 's-1138.json'), 'utf8')),
    tracePath: rec.path(),
    prompt: mod.renderDNAPrompt(dna),
  };

  // ---- UI: real store + real component, SSR stubs ----
  installBrowserStubs();
  await esbuild.build({
    stdin: {
      contents:
        "export { SignaturePanel } from './src/components/SignaturePanel';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: UI_BUNDLE,
    loader: { '.css': 'empty', '.svg': 'dataurl' },
    external: EXTERNALS, plugins: [stubPlugin], logLevel: 'silent',
  });
  ui = require(UI_BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  for (const f of [BUNDLE, UI_BUNDLE]) { try { if (existsSync(f)) unlinkSync(f); } catch { /* gone */ } }
});

const textOf = (html) => html
  .replace(/<[^>]*>/g, '')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&#x2F;/g, '/').replace(/&amp;/g, '&');

function seed(lang = 'en') {
  ui.useStore.setState({
    settings: {
      ...(ui.useStore.getState().settings ?? {}),
      language: lang, numerals: 'western',
      model: { provider: 'custom', model: 'm' },
    },
    wsPath: WS,
    sessions: [real.session],
    session: real.session,
    dna: real.dna,
    running: false,
  });
}
const renderPanel = (props = {}) => renderToStaticMarkup(React.createElement(ui.SignaturePanel, props));

// ============================================================
// 1 · TRAJECTORY REPLAY — three ledgers, one honest thread
// ============================================================
test('trajectory: real session messages give real inputs AND outputs', () => {
  const traj = mod.buildTrajectory({
    sessionId: 's-1138', title: 'Signature proof',
    messages: real.session.messages,
    journalEvents: real.journalEvents,
    traceSteps: real.traceSteps,
  });
  assert.equal(traj.steps.filter((s) => s.kind === 'tool_call').length, 2);
  assert.equal(traj.stats.failedTools, 0);
  assert.equal(traj.truncated, false);
  const call = traj.steps.find((s) => s.kind === 'tool_call' && s.label === 'search_files');
  const result = traj.steps.find((s) => s.kind === 'tool_result' && s.pairedWith === call.index);
  assert.ok(call && result, 'the real call and its result are paired');
  assert.ok(call.input.includes('"query":"signature"'), `real args survived: ${call.input}`);
  assert.ok(result.output.includes('real search hit'), `real output survived: ${result.output}`);
  assert.deepEqual(call.sources, ['session', 'journal']);
  assert.equal(call.durationMs, 12, 'real journal ms attached');
  assert.equal(result.traceChars, 123, 'real trace chars attached');
});

test('trajectory: journal milestones are real events, not invented tool rows', () => {
  const traj = mod.buildTrajectory({ messages: real.session.messages, journalEvents: real.journalEvents });
  const report = traj.steps.find((s) => s.kind === 'milestone' && s.label === 'task_report');
  const finish = traj.steps.find((s) => s.kind === 'milestone' && s.label === 'finish');
  const memory = traj.steps.find((s) => s.kind === 'milestone' && s.label === 'memory_snapshot');
  assert.ok(report && report.output.includes('outcome=complete'), 'real task_report outcome');
  assert.ok(finish && finish.output.includes('completed'), 'real finish outcome');
  assert.ok(memory && memory.output.includes(PATTERN_TEXT), 'real journal memory fact');
  assert.ok(traj.steps.every((s) => s.kind !== 'tool_call' || !!s.label), 'no blank tool rows');
});

test('trajectory: trace-only fallback uses argsPreview and says where it came from', () => {
  const traj = mod.buildTrajectory({ traceSteps: real.traceSteps });
  const call = traj.steps.find((s) => s.kind === 'tool_call' && s.label === 'search_files');
  assert.ok(call, 'a trace-only step exists');
  assert.equal(call.input, '{"query":"signature"}', 'real trace argsPreview used, nothing invented');
  assert.deepEqual(call.sources, ['trace']);
});

test('trajectory: honest empty state and bounded output', () => {
  const empty = mod.buildTrajectory({});
  assert.deepEqual(empty.steps, []);
  assert.equal(empty.emptyReason, 'NO_LEDGER_DATA');
  const capped = mod.buildTrajectory({ messages: real.session.messages, maxSteps: 2 });
  assert.equal(capped.steps.length, 2);
  assert.equal(capped.truncated, true);
  const long = mod.buildTrajectory({
    messages: [{ role: 'tool', kind: 'tool_result', toolName: 'read_file', content: 'x'.repeat(1400) }],
  });
  assert.equal(long.steps[0].outputClipped, true, 'clipping is reported, never a silent cut');
});

// ============================================================
// 2 · DNA AUTOPSY — stored facts + real provenance
// ============================================================
test('autopsy: confidence and evidence come from stored DNA, not a guess', () => {
  const memoryFacts = real.journalEvents
    .filter((e) => e.type === 'memory_snapshot')
    .flatMap((e) => Array.isArray(e.decisions) ? e.decisions : []);
  const report = mod.autopsyDNA({ dna: real.dna, memoryFacts });
  const finding = report.findings.find((f) => f.text.includes(PATTERN_TEXT));
  assert.ok(finding, 'the real stored pattern is explained');
  assert.equal(finding.sightings, 2);
  assert.equal(finding.confidence, 0.7, '0.4 + 0.15 × 2, exactly as stored');
  assert.match(finding.confidenceBasis, /dna\.ts:478/);
  assert.ok(finding.evidence.some((e) => e.source === 'feedback'), 'real feedback note is provenance');
  assert.ok(finding.evidence.some((e) => e.source === 'journal-memory'), 'real journal fact is provenance');
  assert.ok(finding.why.includes('STORED_REPETITION'));
  assert.ok(finding.why.includes('EXPLICIT_FEEDBACK'));
  assert.equal(report.summary.factsRecorded, real.dna.stats.factsRecorded);
  assert.ok(real.prompt.includes(PATTERN_TEXT), 'renderDNAPrompt really renders this pattern');
  assert.equal(finding.promptVisible, true, 'autopsy agrees with the real prompt rule');
});

test('autopsy: profile values are declared facts with no fabricated confidence', () => {
  const report = mod.autopsyDNA({ dna: real.dna });
  const p = report.findings.find((f) => f.kind === 'profile' && f.text === 'typescript');
  assert.ok(p);
  assert.equal(p.confidence, null);
  assert.equal(p.promptVisible, true);
  assert.ok(p.evidence.some((e) => e.source === 'profile'));
});

test('autopsy: empty DNA is an honest empty state, never sample rows', () => {
  const report = mod.autopsyDNA({ dna: {} });
  assert.deepEqual(report.findings, []);
  assert.equal(report.emptyReason, 'NO_DNA_LEARNED');
  assert.equal(report.summary.activePatterns, 0);
});

test('autopsy: the mirrored prompt rule does not drift from the real dna.ts', () => {
  const dnaSrc = src('electron/agent/dna.ts');
  assert.match(dnaSrc, /const MAX_PATTERNS = 60;/);
  assert.match(dnaSrc, /promptPatterns: 8,/);
  assert.match(dnaSrc, /promptNewPatterns: 4,/);
  assert.match(dnaSrc, /21 \* 86_400_000/);
  assert.equal(mod.AUTOPSY_PROMPT_RULE.maxPatterns, 60);
  assert.equal(mod.AUTOPSY_PROMPT_RULE.promptPatterns, 8);
  assert.equal(mod.AUTOPSY_PROMPT_RULE.promptNewPatterns, 4);
});

// ============================================================
// 3 · CAPABILITY COMPASS — real inventory + real call counts
// ============================================================
test('compass: recommendations are real inventory entries with mined routing', () => {
  const defs = mod.CORE_DEFS;
  const names = new Set(defs.map((d) => d.name));
  assert.ok(defs.length >= 140, `real inventory loaded: ${defs.length}`);
  const graph = mod.toolRoutingGraph(defs);
  const edge = graph.find((e) => e.from === 'list_dir' && e.to === 'search_files');
  assert.ok(edge, 'a real "Do NOT use … search_files" sentence became a routing edge');
  assert.match(edge.sentence, /Do NOT use it to search file contents/);

  const route = mod.compass({ intent: 'search files for a symbol', calledToolNames: ['search_files', 'read_file'] });
  assert.ok(route.top.length > 0);
  assert.ok(route.top.every((r) => names.has(r.name)), 'no invented tool names');
  assert.ok(route.top.some((r) => r.name === 'search_files'), 'the routed-to tool wins');
  const sf = route.top.find((r) => r.name === 'search_files');
  assert.ok(sf.reasons.some((r) => r.type === 'routed-here' && r.detail.includes('Do NOT use')),
    'the reason is the real description sentence');
  assert.ok(sf.callCount === 1, 'real call count attached');
  assert.equal(route.coverage.inventory, defs.length);
  assert.equal(route.coverage.called, 2);
  assert.equal(route.coverage.percent, Math.round((2 / defs.length) * 100));
  assert.ok(route.undiscovered.length > 0 && route.undiscovered.every((u) => names.has(u.name) && u.hint),
    'unused capabilities are real tools with real description hints');
});

test('compass: unknown ledger names and empty intent are reported honestly', () => {
  const route = mod.compass({ intent: 'search files', calledToolNames: ['search_files', 'mcp__x__y'] });
  assert.equal(route.coverage.unknownCalled, 1);
  assert.deepEqual(route.coverage.unknownNames, ['mcp__x__y']);
  // The real CORE_DEFS inventory is still present even when nothing is called.
  const empty = mod.compass({ intent: '', calledToolNames: [] });
  assert.deepEqual(empty.top, []);
  assert.equal(empty.emptyReason, 'EMPTY_INTENT');
  assert.equal(empty.coverage.inventory, mod.CORE_DEFS.length);
});

// ============================================================
// 4 · UI — the new rail panel really renders (EN + AR), no dead controls
// ============================================================
test('SSR EN: SignaturePanel renders real replay data through the registry component', () => {
  seed('en');
  const html = renderPanel();
  const text = textOf(html);
  assert.ok(html.includes('class="sg-panel'), 'panel markup');
  // v11.42 — DNA INSIGHTS moved to DnaPanel; this rail has two instruments.
  assert.ok(html.includes('REPLAY') && html.includes('COMPASS'));
  assert.ok(!html.includes('DNA INSIGHTS'), 'no insights tab on the Signature rail');
  assert.ok(text.includes('search_files'), 'real tool name on screen');
  assert.ok(text.includes('real search hit'), 'real tool output on screen');
  assert.ok(html.includes('session'), 'honest provenance stamp');
  assert.ok(!/\p{Script=Arabic}/u.test(text), 'single language EN');
});

test('SSR AR: the same panel is RTL and Arabic-only', () => {
  seed('ar');
  const html = renderPanel();
  const text = textOf(html);
  assert.ok(html.includes('dir="rtl"'));
  assert.ok(text.includes('إعادة العرض') && text.includes('بوصلة الأدوات'));
  assert.ok(text.includes('search_files'), 'real data survives translation');
  for (const en of ['REPLAY', 'DNA AUTOPSY', 'COMPASS', 'input', 'output', 'calls', 'no recorded sessions']) {
    assert.ok(!text.includes(en), `no English UI copy in AR surface: ${en}`);
  }
});

test('SSR: compass tab renders real tools (insights moved to DnaPanel in v11.42)', () => {
  seed('en');
  // The four former `initialTab: 'insights'` finding assertions moved to
  // tests/v1142-dna-insights.test.mjs — they now render from DnaPanel.
  const compass = textOf(renderPanel({ initialTab: 'compass', initialIntent: 'search files for a symbol' }));
  assert.ok(compass.includes('search_files'), 'real recommendation rendered');
  assert.ok(compass.includes('UNUSED CAPABILITIES'), 'real coverage-gap section rendered');
  assert.ok(/\d+\/\d+/.test(compass), 'real inventory coverage numbers');
});

test('source guards: registry registration, no dead controls, no unstable selectors', () => {
  const registry = src('src/components/panels/registry.tsx');
  assert.match(registry, /signature:\s*SignaturePanel/, 'panel registered in the rail registry');
  assert.match(registry, /signature:\s*'16'/, 'rail number registered');
  // The v1131-full-smoke coverage guard enumerates panelOf(XMod,'Name') and
  // requires each in its SCREENS list. Direct import keeps that guard green.
  const panelNames = [...registry.matchAll(/panelOf\((\w+)Mod,\s*'(\w+)'\)/g)].map((m) => m[2]);
  assert.ok(!panelNames.includes('SignaturePanel'), 'direct import preserves the smoke guard contract');
  assert.match(registry, /new Set<(?:RailView|AllRail)>\(\[/, 'STAGE_RAILS literal kept for v1131-ui-shell');

  const panel = src('src/components/SignaturePanel.tsx');
  assert.ok(!/useStore\s*\(\s*\(?\s*\w+\s*\)?\s*=>\s*\(\s*\{/.test(panel), 'no object-literal selector');
  assert.ok(!/useStore\s*\(\s*\(?\s*\w+\s*\)?\s*=>\s*\[/.test(panel), 'no array-literal selector');
  const tags = panel.match(/<(?:button|input|select)\b[^>]*>/g) ?? [];
  assert.ok(tags.length >= 3, 'interactive controls present');
  for (const tag of tags) {
    assert.ok(/onClick=|onChange=/.test(tag), `control is wired: ${tag.slice(0, 100)}`);
  }
  assert.match(src('src/components/signature-art.css'), /prefers-reduced-motion/);
  assert.ok(!/box-shadow|linear-gradient|radial-gradient/.test(src('src/components/signature-art.css')),
    'hairline grammar: no boxy shadows or gradients');
});

test('manifest: the three features report real sources only', () => {
  assert.deepEqual(mod.SIGNATURE_FEATURES.map((f) => f.id), ['trajectory', 'autopsy', 'compass']);
  for (const f of mod.SIGNATURE_FEATURES) assert.ok(f.source && f.api, `${f.id} declares its real source`);
});
