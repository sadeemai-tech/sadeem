// ============================================================
// v11.43 — PROOF CENTER verification.
//
// Not a source-string vanity check: this bundles the REAL ProofPanel,
// seeds the REAL zustand store with a REAL proof event shape (the same
// tool_call/tool_result + gate objects the store ingests), renders it
// server-side, and asserts an actual row appears with the actual
// evidence — plus the honest empty state when no proof exists.
//
//   node --test --test-force-exit tests/v1143-proof-center.test.mjs
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

let React;
let renderToStaticMarkup;
let M;
const bundleFiles = [];

const EXTERNALS = ['electron', 'react', 'react-dom', 'zustand', 'lucide-react', '@xterm/xterm', '@xterm/addon-fit'];
const stubPlugin = {
  name: 'v1143-stubs',
  setup(build) {
    build.onResolve({ filter: /\?worker$/ }, () => ({ path: 'worker', namespace: 'ss' }));
    build.onResolve({ filter: /(^|\/)lib\/monaco$/ }, () => ({ path: 'monaco', namespace: 'ss' }));
    build.onResolve({ filter: /^@monaco-editor\/react$/ }, () => ({ path: 'monaco-react', namespace: 'ss' }));
    build.onResolve({ filter: /^lottie-web$/ }, () => ({ path: 'lottie', namespace: 'ss' }));
    build.onResolve({ filter: /^qrcode$/ }, () => ({ path: 'qrcode', namespace: 'ss' }));
    build.onLoad({ filter: /.*/, namespace: 'ss' }, (a) => {
      const c = {
        worker: 'export default class W {};',
        monaco: 'export const monaco = {}; export const monacoThemeFor=()=>""; export const languageForPath=()=>"plaintext";',
        'monaco-react': 'const N=()=>null; export const Editor=N; export const DiffEditor=N; export const loader={config(){},init(){return Promise.resolve({})}};',
        lottie: 'export const loadAnimation=()=>({destroy(){},play(){},stop(){},goToAndStop(){}}); export default {loadAnimation};',
        qrcode: 'export const toDataURL=()=>Promise.resolve(""); export const toString=()=>Promise.resolve(""); export default {toDataURL,toString};',
      }[a.path] ?? 'export default null;';
      return { contents: c, loader: 'js' };
    });
  },
};

function installBrowserStubs() {
  const bridge = new Proxy({}, {
    get(_t, k) {
      if (k === 'then' || k === 'toJSON' || typeof k === 'symbol') return undefined;
      return (..._a) => Promise.resolve(undefined);
    },
  });
  const mq = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
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
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, matchMedia: mq,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    location: { href: 'http://localhost/', reload() {} },
    navigator: { userAgent: 'node-v1143', clipboard: { writeText: () => Promise.resolve() } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    scrollTo() {}, alert() {}, confirm: () => true, prompt: () => null,
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
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
}

before(async () => {
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
  installBrowserStubs();
  const outfile = join(ROOT, 'tests', '.v1143-proof-center.bundle.cjs');
  await esbuild.build({
    stdin: {
      contents:
        "export { ProofPanel, deriveProofLedger } from './src/components/panels/ProofPanel';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile,
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.jpg': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
    external: EXTERNALS, plugins: [stubPlugin], logLevel: 'silent',
  });
  bundleFiles.push(outfile);
  M = require(outfile);
});

after(() => {
  for (const f of bundleFiles) { try { unlinkSync(f); } catch { /* gone */ } }
});

const T0 = 1_700_000_000_000;
const sessionWithRealProof = {
  id: 'v1143-proof-session', title: 'Proof run',
  messages: [
    { id: 'u', role: 'user', kind: 'text', content: 'fix and test', timestamp: T0 },
    // REAL tool evidence: a command was claimed, then a result arrived with
    // output + ok bit. This is exactly what store.ts pushes on tool_result.
    { id: 'c1', role: 'tool', kind: 'tool_call', toolName: 'run_command', toolCallId: 'call-1',
      content: JSON.stringify({ command: 'npm test -- --run' }), timestamp: T0 + 10 },
    { id: 'r1', role: 'tool', kind: 'tool_result', toolCallId: 'call-1', toolName: 'run_command',
      content: 'PASS src/a.test.ts (5 tests) exit 0', resultOk: true, timestamp: T0 + 20 },
    // A failed write: honest 'failed', not green.
    { id: 'c2', role: 'tool', kind: 'tool_call', toolName: 'edit_file', toolCallId: 'call-2',
      content: JSON.stringify({ path: 'src/broken.ts' }), timestamp: T0 + 30 },
    { id: 'r2', role: 'tool', kind: 'tool_result', toolCallId: 'call-2', toolName: 'edit_file',
      content: 'ENOENT: no such file', resultOk: false, timestamp: T0 + 40 },
    // A screenshot result with real image bytes → fingerprint row.
    { id: 'c3', role: 'tool', kind: 'tool_call', toolName: 'preview_screenshot', toolCallId: 'call-3',
      content: JSON.stringify({ url: 'http://localhost:3000/' }), timestamp: T0 + 50 },
    { id: 'r3', role: 'tool', kind: 'tool_result', toolCallId: 'call-3', toolName: 'preview_screenshot',
      content: 'captured', resultOk: true, images: ['data:image/png;base64,QUJDREVG'], timestamp: T0 + 60 },
    // A claim with NO result yet → must stay 'unverified'.
    { id: 'c4', role: 'tool', kind: 'tool_call', toolName: 'write_file', toolCallId: 'call-4',
      content: JSON.stringify({ path: 'src/unfinished.ts' }), timestamp: T0 + 70 },
  ],
  createdAt: 1, updatedAt: 1, messageCount: 8, totalTokens: 0, totalCostUsd: 0,
};

const realGates = [
  { id: 'verify', tone: 'ok', detail: 'npm test -- --run — exit 0', at: T0 + 80 },
  { id: 'fakes', tone: 'bad', detail: '2 high-severity findings of 12 scanned', at: T0 + 90 },
];

function seed(messages, gates, mutation = null, status = 'failed') {
  M.useStore.setState({
    booted: true,
    settings: { ...M.useStore.getState().settings, language: 'en', numerals: 'western' },
    session: messages ? { ...sessionWithRealProof, messages } : { ...sessionWithRealProof, messages: [] },
    proof: { status, gates, updatedAt: gates.length ? T0 + 90 : 0, mutation },
  });
}
const render = () => renderToStaticMarkup(React.createElement(M.ProofPanel));
const rowCount = (html) => (html.match(/data-testid="proof-row"/g) || []).length;

test('PURE: real proof events derive honest statuses — no fabricated green', () => {
  const rows = M.deriveProofLedger(sessionWithRealProof.messages, realGates, 'en', null);
  assert.equal(rows.length, 6, '4 tool events (incl. 1 pending) + 2 real gates');

  const cmd = rows.find((r) => r.kind === 'command');
  assert.ok(cmd, 'command row exists');
  assert.equal(cmd.status, 'verified', 'ok tool_result ⇒ verified');
  assert.match(cmd.evidence, /npm test -- --run/);
  assert.match(cmd.evidence, /exit 0/);

  const bad = rows.find((r) => r.kind === 'file' && r.evidence.includes('broken'));
  assert.equal(bad?.status, 'failed', 'failed tool_result ⇒ failed, never green');

  const pending = rows.find((r) => r.id === 'pending-call-4');
  assert.equal(pending?.status, 'unverified', 'call without result stays unverified');
  assert.match(pending.evidence, /no result recorded/);

  const shot = rows.find((r) => r.kind === 'screenshot');
  assert.equal(shot?.status, 'verified');
  assert.match(shot.evidence, /fp: [0-9a-f]{8}/, 'real image bytes produce a fingerprint label');

  const verify = rows.find((r) => r.id.startsWith('gate-verify'));
  assert.equal(verify?.status, 'verified');
  assert.equal(verify.source, 'run', 'gates are labelled as current-run data');

  const fakes = rows.find((r) => r.id.startsWith('gate-fakes'));
  assert.equal(fakes?.status, 'failed');

  // Inconclusive mutation gate is NEVER green even with an 'ok' rollup tone.
  const mut = M.deriveProofLedger([], [
    { id: 'mutation', tone: 'ok', detail: 'weak', at: 1 },
  ], 'en', { verdict: 'weak', ran: 4, killed: 2, inconclusive: true });
  assert.equal(mut[0].status, 'unverified', 'inconclusive mutation gate is unverified');
});

test('SSR: a REAL proof event renders as a real ledger row with its evidence', () => {
  seed(sessionWithRealProof.messages, realGates);
  const html = render();
  assert.match(html, /data-testid="proof-center"/);
  assert.ok(rowCount(html) >= 6, `expected real rows, got ${rowCount(html)}`);
  assert.match(html, /npm test -- --run/, 'command text from the real tool_call is rendered');
  assert.match(html, /PASS src\/a\.test\.ts/, 'real command output is rendered');
  assert.match(html, /src\/broken\.ts/, 'real file path is rendered');
  assert.match(html, /data-status="failed"/, 'failed evidence is honestly marked');
  assert.match(html, /data-status="unverified"/, 'result-less claim is honestly marked');
  assert.match(html, /fp: [0-9a-f]{8}/, 'screenshot fingerprint is rendered');
  assert.match(html, /data-testid="proof-engine-verdict"/, 'engine verdict is shown separately from ledger rows');
  assert.match(html, /Copy ledger/, 'a real copy action exists');
});

test('SSR: empty store shows the honest empty state — no fabricated green', () => {
  seed([], []);
  const html = render();
  assert.match(html, /No proof recorded yet — run tests or preview to generate evidence\./);
  assert.match(html, /data-testid="proof-empty"/);
  assert.equal(rowCount(html), 0, 'zero rows when no proof exists');
  assert.ok(!/data-status="verified"/.test(html), 'no green rows can appear from nothing');
});

test('WIRING: one additive Proof rail entry is registered, ribbon stays a copy button', () => {
  const reg = readFileSync(join(ROOT, 'src/components/panels/registry.tsx'), 'utf8');
  assert.match(reg, /import \{ ProofPanel \} from '\.\/ProofPanel';/);
  assert.match(reg, /proof: ProofPanel,/);
  assert.match(reg, /proof: '17',/);
  assert.match(reg, /'proof', \/\/ v11\.43/);
  const ribbon = readFileSync(join(ROOT, 'src/components/ProofRibbon.tsx'), 'utf8');
  assert.equal((ribbon.match(/<button/g) || []).length, 1, 'ribbon still has exactly one button (smoke V3)');
  assert.ok(ribbon.includes('onClick={handleProofCopy}'), 'ribbon click still copies real evidence');
  assert.ok(ribbon.includes("('proof')"), 'ribbon click also opens the real Proof Center (reachable entry point)');
  assert.ok(ribbon.includes('clip.writeText('), 'copy stays real — no fake success state');
});

test('CONTROLS: every Proof Center control is wired (no dead handlers)', () => {
  const src = readFileSync(join(ROOT, 'src/components/panels/ProofPanel.tsx'), 'utf8');
  const controls = (src.match(/<(?:button|input)\b/g) || []).length;
  const handlers = (src.match(/onClick=|onChange=/g) || []).length;
  assert.ok(controls >= 7, `expected the real filter/copy controls, got ${controls}`);
  assert.equal(handlers, controls, 'one real handler per control — no dead control');
  assert.ok(!/onClick=\{\(\) => \{\}\}/.test(src), 'no explicit no-op handler');
});
