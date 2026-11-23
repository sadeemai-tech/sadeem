// ============================================================
// v11.42 — EFFORT / REASONING CONTROL HARDENING (the founder's F12 follow-up)
// ------------------------------------------------------------
// "بسحب الهاي والشو اسمه" — the rail jumped, lost its value and mislabelled.
// This suite proves the REAL fixes with exact file:line on failure:
//   1 · source truth: GPT 4 names→reasoning_effort, o-series 3, Claude token
//       budgets, GLM 3, Gemini 2 honest no-field, unknown = curated (no lie)
//   2 · catalogue: an advertised supported_parameters drives the wire field;
//       no row / no parameter → honest curated fallback
//   3 · STABILITY: the selected NAME survives a model switch; the slider
//       re-scales to the new model's own stop count; the wire field is intact
//   4 · the dead first stop is gone; cross-model carry is wired in BOTH the
//       chat control and the picker; the two axes are visually separated
//   5 · design law: hairline, serif title, tabular mono value, RTL-safe,
//       BOTH reduced-motion guards, no boxy card / keyframes
//   6 · SSR of the REAL ReasoningSlider: exact stop count + names per model
//
//   node --test --test-force-exit tests/v1142-effort.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const lineOf = (src, needle) => src.slice(0, Math.max(0, src.indexOf(needle))).split('\n').length;

const EFFORT = read('src/components/EffortControl.tsx');
const PICKER = read('src/components/ModelPicker.tsx');
const SHARED = read('shared/effort.ts');
const PROV = read('electron/agent/providers.ts');
const CSS = read('src/components/effort.css');

const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1142-effort-'));
const outfile = join(tmp, 'effort-graph.cjs');
after(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

// ONE bundle ⇒ one catalog cache instance, so seeding really affects the wire.
await esbuild.build({
  stdin: {
    contents: [
      "export * as effort from './shared/effort';",
      "export * as providers from './electron/agent/providers';",
      "export * as catalog from './electron/services/openrouterCatalog';",
    ].join('\n'),
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'cjs', outfile,
  external: ['electron'], logLevel: 'silent',
});
const M = require(outfile);

const names = (d) => d.levels.map((l) => l.name);
const bodyFor = (provider, model, reasoning) => M.providers.buildOpenAIRequestBody({
  model: { provider, model, maxTokens: 8192, temperature: 0.2, reasoning },
  apiKey: 'test-key', baseUrl: 'https://api.openai.com/v1',
  system: 'You are a coding agent.',
  messages: [{ role: 'user', text: 'fix the bug' }],
  tools: [], signal: new AbortController().signal, promptCaching: false,
  onText() {}, onToolUse() {},
}).body;

// ---------------------------------------------------------------------
// 1 · SOURCE TRUTH — real names, real counts, real wire fields
// ---------------------------------------------------------------------
test('1a · GPT = 4 real OpenAI names → reasoning_effort; o-series = 3 (no invented minimal)', () => {
  const gpt = M.effort.effortLevelsFor('openai', 'gpt-6-astra');
  assert.deepEqual(names(gpt), ['minimal', 'low', 'medium', 'high']);
  assert.equal(gpt.param, 'reasoning_effort');
  assert.equal(gpt.source, 'curated');
  assert.equal(gpt.defaultLevel, 'minimal', 'no silent reasoning on an unset value');
  assert.equal(bodyFor('openai', 'gpt-6-astra', 'high').reasoning_effort, 'high');
  assert.equal(bodyFor('openai', 'gpt-6-astra', 'off').reasoning_effort, undefined,
    'off is the universal "send no field" sentinel');

  const o = M.effort.effortLevelsFor('openai', 'o3');
  assert.deepEqual(names(o), ['low', 'medium', 'high']);
  assert.equal(bodyFor('openai', 'o3', 'high').reasoning_effort, 'high');
});

test('1b · Claude = none→high with REAL token budgets on thinking.budget_tokens', () => {
  const claude = M.effort.effortLevelsFor('anthropic', 'claude-sonnet-5.5');
  assert.deepEqual(names(claude), ['none', 'low', 'medium', 'high']);
  assert.equal(claude.param, 'thinking.budget_tokens');
  assert.deepEqual(claude.budgets, { none: 0, off: 0, low: 2048, medium: 8192, high: 16384 });
  assert.deepEqual(M.effort.effortWireFor(claude, 'high'),
    { thinking: { type: 'enabled', budget_tokens: 16384 } });
  assert.deepEqual(M.effort.effortWireFor(claude, 'low'),
    { thinking: { type: 'enabled', budget_tokens: 2048 } });
  assert.deepEqual(M.effort.effortWireFor(claude, 'none'), {});
  assert.equal(M.effort.effortLevelDetail(claude, 'high'), '16,384 tok');
  assert.equal(M.effort.effortLevelDetail(claude, 'medium'), '8,192 tok');
  assert.equal(M.effort.effortLevelDetail(claude, 'low'), '2,048 tok');
  assert.equal(M.effort.effortLevelDetail(claude, 'none'), 'off');
  assert.equal(M.providers.wantedThinkingBudget('anthropic', 'claude-sonnet-5.5', 'high'), 16384);
  assert.equal(M.providers.wantedThinkingBudget('openai', 'gpt-6-astra', 'high'), 0,
    'a GPT stop must never become an Anthropic budget');
});

test('1c · GLM 3 / Gemini 2 honest / unknown curated — never invent a capability', () => {
  assert.deepEqual(names(M.effort.effortLevelsFor('zai', 'glm-5.3')), ['low', 'high', 'max']);
  // v1142: the GLM stops are no longer decorative — the descriptor gate now
  // sends the real wire field on the native provider too.
  assert.equal(bodyFor('zai', 'glm-5.3', 'high').reasoning_effort, 'high');

  const gemini = M.effort.effortLevelsFor('gemini', 'gemini-4-argon');
  assert.deepEqual(names(gemini), ['low', 'high']);
  assert.equal(gemini.param, 'none');
  assert.deepEqual(M.effort.effortWireFor(gemini, 'high'), {});
  assert.equal(M.effort.effortLevelDetail(gemini, 'high'), 'no field');
  assert.match(gemini.note.en, /no named effort field/i);

  const unknown = M.effort.effortLevelsFor('custom', 'totally-unknown-xyz');
  assert.deepEqual(names(unknown), ['off', 'low', 'medium', 'high']);
  assert.equal(unknown.source, 'curated');
  assert.ok(unknown.note.en.length > 10 && unknown.note.ar.length > 10);
  assert.equal(M.effort.normalizeEffortLevel(unknown, 'nonsense'), 'off');
  assert.equal(M.effort.effortLevelDetail(M.effort.effortLevelsFor('openai', 'gpt-6-astra'), 'high'),
    'reasoning_effort');
});

// ---------------------------------------------------------------------
// 2 · CATALOGUE TRUTH — capability from the provider, names stay curated
// ---------------------------------------------------------------------
const FIXTURE = {
  data: [
    { id: 'openai/gpt-6-astra', name: 'GPT-6 Astra', context_length: 400000,
      supported_parameters: ['temperature', 'reasoning_effort', 'tools'] },
    { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', context_length: 400000,
      supported_parameters: ['temperature', 'tools'] },
  ],
};

test('2a · advertised supported_parameters drive the descriptor; missing ones stay curated', () => {
  const rows = M.catalog.parseOpenRouterModels(FIXTURE);
  assert.equal(M.catalog.openrouterEffortSignalFor('openai/gpt-6-astra', rows).supportsReasoningEffort, true);
  assert.equal(M.catalog.openrouterEffortSignalFor('openai/gpt-6-luna', rows).supportsReasoningEffort, false);
  assert.equal(M.catalog.openrouterEffortSignalFor('not/in-catalog', rows), null);

  const fromRows = M.effort.effortSignalFromRows('openai/gpt-6-astra',
    rows.map((r) => ({ id: r.id, supportedParameters: r.supportedParameters })));
  assert.equal(fromRows.supportsReasoningEffort, true, 'renderer twin sees the same real capability');
  assert.equal(M.effort.effortSignalFromRows('not/in-catalog', []), null);

  M.catalog.__seedOpenRouterCatalogForTest(rows);
  const confirmed = M.providers.effortDescriptorFor('openrouter', 'openai/gpt-6-astra');
  assert.equal(confirmed.source, 'provider-catalog');
  assert.equal(confirmed.param, 'reasoning_effort');
  assert.match(confirmed.note.en, /Stop names are curated/i, 'honest: names are NOT claimed as fetched');
  assert.equal(bodyFor('openrouter', 'openai/gpt-6-astra', 'high').reasoning_effort, 'high');

  const unlisted = M.providers.effortDescriptorFor('openrouter', 'openai/gpt-6-luna');
  assert.equal(unlisted.source, 'curated', 'no advertised parameter = honest curated fallback');
  M.catalog.__resetOpenRouterCatalogForTest();
});

// ---------------------------------------------------------------------
// 3 · STABILITY — the founder's "it drags the high / loses the value"
// ---------------------------------------------------------------------
test('3a · the chosen NAME survives a model switch while the rail re-scales', () => {
  const gpt = M.effort.effortLevelsFor('openai', 'gpt-6-astra');   // 4 stops
  const o = M.effort.effortLevelsFor('openai', 'o3');              // 3 stops
  const carried = M.effort.carryEffortLevel(o, 'medium');
  assert.equal(carried, 'medium', 'the name is carried, not the index');

  const iGpt = M.effort.effortLevelIndex(gpt, 'medium');
  const iO = M.effort.effortLevelIndex(o, carried);
  assert.equal(iGpt, 2, 'GPT medium = index 2 of 4');
  assert.equal(iO, 1, 'o-series medium = index 1 of 3');
  assert.equal(gpt.levels[iGpt].name, o.levels[iO].name, 'same stop, different scale — correct, not a jump');

  assert.equal(M.effort.effortWireFor(gpt, carried).reasoning_effort, 'medium');
  assert.equal(M.effort.effortWireFor(o, carried).reasoning_effort, 'medium', 'wire field unchanged');
  assert.equal(M.effort.normalizeEffortLevel(o, carried), 'medium');
});

test('3b · off-like stops stay off across families; stale names are dropped, never invented', () => {
  const gpt = M.effort.effortLevelsFor('openai', 'gpt-6-astra');
  const claude = M.effort.effortLevelsFor('anthropic', 'claude-sonnet-5.5');
  const o = M.effort.effortLevelsFor('openai', 'o3');

  assert.equal(M.effort.carryEffortLevel(gpt, 'none'), 'off', 'Claude none never becomes GPT minimal');
  assert.equal(M.effort.carryEffortLevel(claude, 'off'), 'off', 'universal off sentinel');
  assert.deepEqual(M.effort.effortWireFor(gpt, M.effort.carryEffortLevel(gpt, 'none')), {},
    'no reasoning_effort is silently turned on');
  assert.equal(M.effort.normalizeEffortLevel(claude, M.effort.carryEffortLevel(claude, 'off')), 'none');
  assert.deepEqual(M.effort.effortWireFor(claude, M.effort.carryEffortLevel(claude, 'off')), {});

  assert.equal(M.effort.carryEffortLevel(o, 'minimal'), undefined,
    'a stale GPT-only stop is dropped, not clamped to a fabricated low');
  assert.equal(M.effort.carryEffortLevel(o, undefined), undefined, 'unset stays unset');
  assert.equal(M.effort.carryEffortLevel(o, 'high'), 'high');
});

test('3c · the wire really changes when the named stop changes (both axes)', () => {
  const gpt = M.effort.effortLevelsFor('openai', 'gpt-6-astra');
  assert.equal(bodyFor('openai', 'gpt-6-astra', gpt.levels[1].name).reasoning_effort, 'low');
  assert.equal(bodyFor('openai', 'gpt-6-astra', gpt.levels[2].name).reasoning_effort, 'medium');
  assert.notEqual(
    bodyFor('openai', 'gpt-6-astra', gpt.levels[1].name).reasoning_effort,
    bodyFor('openai', 'gpt-6-astra', gpt.levels[2].name).reasoning_effort,
  );
});

// ---------------------------------------------------------------------
// 4 · SOURCE WIRING — no dead stop, no conflated axis, carry on every path
// ---------------------------------------------------------------------
test('4a · the first stop is no longer dead; the two axes are separated', () => {
  assert.ok(!/next === reasoningLevel/.test(EFFORT),
    `EffortControl.tsx :: the normalized compare that killed the first stop is gone`);
  assert.match(EFFORT, /next === modelCfg\.reasoning/,
    `EffortControl.tsx:${lineOf(EFFORT, 'next === modelCfg.reasoning')} :: explicit click persists even when unset`);
  assert.match(EFFORT, /carryEffortLevel\(desc, prev\.reasoning\)/,
    `EffortControl.tsx:${lineOf(EFFORT, 'carryEffortLevel(desc, prev.reasoning)')} :: cross-model carry in the chat`);
  assert.match(PICKER, /carryEffortLevel\(nextDesc, previous\)/,
    `ModelPicker.tsx:${lineOf(PICKER, 'carryEffortLevel(nextDesc, previous)')} :: cross-model carry in the picker`);
  assert.ok(!/carried !== nextDesc\.defaultLevel/.test(PICKER),
    'the picker no longer drops a carried value that equals the new default');
  assert.match(EFFORT, /effort-rail--model/, 'the model rail has its own visual identity');
  assert.match(EFFORT, /effort-rail--engine/, 'the engine rail is explicitly separated');
  assert.match(EFFORT, /Engine step budget/, 'the engine axis is labelled, not silently mixed in');
  assert.match(EFFORT, /data-effort-name=\{desc\.levels\[idx\]\?\.name/, 'the slider exposes the chosen NAME');
  assert.match(EFFORT, /data-effort-count=\{desc\.levels\.length\}/, 'the slider exposes the model\'s OWN stop count');
  assert.match(SHARED, /export function carryEffortLevel\(/, 'the single carry helper lives in shared/effort');
  assert.match(PROV, /trustedFamily/,
    `providers.ts:${lineOf(PROV, 'trustedFamily')} :: descriptor-driven gate (GLM no longer decorative)`);
});

test('4b · design law — hairline, serif, tabular mono, RTL, both motion guards', () => {
  assert.match(CSS, /--font-display-serif/, 'Instrument Serif title token');
  assert.match(CSS, /\[dir='rtl'\]/, 'explicit RTL guard');
  assert.match(CSS, /font-variant-numeric: tabular-nums/, 'tabular mono current value');
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/, 'OS motion guard');
  assert.match(CSS, /html\.reduce-motion/, 'in-app motion guard');
  assert.match(CSS, /border-block-start: 1px solid var\(--line-soft\)/, 'a single hairline rule');
  const shadows = [...CSS.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(shadows.length > 0 && shadows.every((v) => v === 'none'), 'no box shadow — no boxy card');
  const cssRules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/gradient|@keyframes/.test(cssRules), 'no gradient, no keyframes in actual rules');
  assert.match(EFFORT, /import '\.\/effort\.css'/, 'the new stylesheet is actually loaded');
});

// ---------------------------------------------------------------------
// 5 · SSR — render the REAL slider with each model's own descriptor
// ---------------------------------------------------------------------
let React;
let renderToStaticMarkup;
let SSR;

const EXTERNALS = ['electron', 'react', 'react-dom', 'zustand', 'lucide-react', '@xterm/xterm', '@xterm/addon-fit'];
const stubPlugin = {
  name: 'v1142-ssr-stubs',
  setup(build) {
    build.onResolve({ filter: /\?worker$/ }, () => ({ path: 'worker', namespace: 'ssm' }));
    build.onResolve({ filter: /(^|\/)lib\/monaco$/ }, () => ({ path: 'lib-monaco', namespace: 'ssm' }));
    build.onResolve({ filter: /^@monaco-editor\/react$/ }, () => ({ path: 'monaco-react', namespace: 'ssm' }));
    build.onResolve({ filter: /^lottie-web$/ }, () => ({ path: 'lottie', namespace: 'ssm' }));
    build.onResolve({ filter: /^qrcode$/ }, () => ({ path: 'qrcode', namespace: 'ssm' }));
    build.onLoad({ filter: /.*/, namespace: 'ssm' }, (a) => {
      let contents;
      switch (a.path) {
        case 'worker': contents = 'export default class SSMWorker {}'; break;
        case 'lib-monaco':
          contents = 'const monaco = { editor: { defineTheme(){}, createModel(){}, createDiffEditor(){} } };'
            + 'export { monaco }; export const monacoThemeFor = () => "surnia-dark";'
            + 'export const languageForPath = () => "plaintext";';
          break;
        case 'monaco-react':
          contents = 'const Nil = () => null; export const Editor = Nil; export const DiffEditor = Nil;'
            + 'export const loader = { config(){}, init(){ return Promise.resolve({}); } };';
          break;
        case 'lottie': contents = 'export const loadAnimation = () => ({ destroy(){}, play(){}, stop(){}, goToAndStop(){} });'; break;
        case 'qrcode': contents = 'export const toDataURL = () => Promise.resolve(""); export const toString = () => Promise.resolve("");'; break;
        default: contents = 'export default null;';
      }
      return { contents, loader: 'js' };
    });
  },
};

before(async () => {
  const bridge = new Proxy({}, {
    get(_t, key) {
      if (key === 'then' || key === 'toJSON' || typeof key === 'symbol') return undefined;
      return () => Promise.resolve(undefined);
    },
  });
  const mq = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const el = () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    appendChild() {}, removeChild() {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, focus() {}, select() {}, remove() {}, click() {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
    querySelector: () => null, querySelectorAll: () => [], insertBefore() {}, scrollTo() {},
  });
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
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, scrollTo() {},
  };
  globalThis.document = {
    documentElement: el(), body: el(), head: el(),
    createElement: el, createElementNS: el, createTextNode: () => ({}),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, hidden: false, visibilityState: 'visible',
  };
  const def = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  def('localStorage', globalThis.window.localStorage);
  def('sessionStorage', globalThis.window.sessionStorage);
  def('matchMedia', mq);
  def('navigator', globalThis.window.navigator);
  def('location', globalThis.window.location);
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });

  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;

  const ssrFile = join(ROOT, 'tests', '.v1142-effort.bundle.cjs');
  await esbuild.build({
    stdin: {
      contents: "export { ReasoningSlider, EffortControl } from './src/components/EffortControl';"
        + "export { useStore } from './src/store';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: ssrFile,
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
    external: EXTERNALS, plugins: [stubPlugin], logLevel: 'silent',
  });
  SSR = require(ssrFile);
});

const h = (...args) => React.createElement(...args);
const railFor = (provider, model, level) => {
  SSR.useStore.setState({ settings: { ...SSR.useStore.getState().settings, language: 'en' } });
  const desc = M.effort.effortLevelsFor(provider, model);
  return renderToStaticMarkup(h(SSR.ReasoningSlider, { desc, level, onChange() {} }));
};

test('5a · SSR · GPT rail renders exactly 4 own-named stops; range max = 3', () => {
  const html = railFor('openai', 'gpt-6-astra', 'medium');
  assert.match(html, /data-testid="chat-effort-rail-permodel"/);
  assert.equal((html.match(/data-effort-name=/g) || []).length, 5,
    '4 stop buttons + 1 on the range input');
  assert.match(html, /max="3"/, '4 stops → max index 3');
  assert.match(html, /step="1"/);
  assert.match(html, /data-effort-count="4"/);
  assert.match(html, /data-effort-name="medium"/);
  for (const label of ['Minimal', 'Low', 'Medium', 'High']) assert.ok(html.includes(label), label);
  assert.match(html, /aria-valuetext="Medium"/, 'current value is the model\'s own name');
  assert.ok(html.includes('is-on'), 'exactly one stop is active');
});

test('5b · SSR · o-series re-scales to 3 stops; Claude shows real budgets', () => {
  const o = railFor('openai', 'o3', 'high');
  assert.match(o, /max="2"/, '3 stops → max index 2');
  assert.match(o, /data-effort-count="3"/);
  assert.ok(!o.includes('Minimal'), 'no fabricated minimal on an o-series model');
  assert.match(o, /aria-valuetext="High"/);

  const claude = railFor('anthropic', 'claude-sonnet-5.5', 'high');
  assert.match(claude, /data-effort-count="4"/);
  assert.match(claude, /16,384 tok/, 'the REAL budget, not a decorative label');
  assert.match(claude, /2,048 tok/);
});

test('5c · SSR · closed trigger shows the engine stage AND the model stop', () => {
  SSR.useStore.setState({ settings: {
    ...SSR.useStore.getState().settings, language: 'en',
    agent: { effort: 'deep' },
    model: { provider: 'openai', model: 'gpt-6-astra', reasoning: 'high' },
  } });
  const chip = renderToStaticMarkup(h(SSR.EffortControl));
  assert.match(chip, /data-testid="chat-effort-trigger"/);
  assert.ok(chip.includes('Effort') && chip.includes('deep'), 'engine stage still exposed (v1137 contract)');
  assert.ok(chip.includes('High'), 'the model\'s own stop is shown too');
  assert.ok(!chip.includes('role="dialog"'), 'nothing rendered while closed');
});
