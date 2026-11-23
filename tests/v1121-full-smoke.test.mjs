// ============================================================
// v11.21 — FULL SURFACE SMOKE TEST (the founder's "تأكد من كل الأقسام" gate).
//
// Goal: render EVERY major screen headlessly (SSR) with a mocked api/store,
// prove none of them throw, prove none carry the React #300 *unstable
// selector* pattern, and statically hunt for dead (unwired) controls.
//
// The test is INTENTIONALLY loud: a crash or a dead control is reported with
// an exact file:line. It does not paper over failures to keep a green wash.
//
//   node --test --test-force-exit tests/v1121-full-smoke.test.mjs
//
// Ownership: this is a TEST-ONLY file. Application source is never edited.
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const TMP = join(tmpdir(), 'sadeem-v1121-full-smoke');
mkdirSync(TMP, { recursive: true });
const RESULT_JSON = join(TMP, 'results.json');
const CRASH_LOG = join(TMP, 'crashes.log');

// ------------------------------------------------------------
// Screen inventory — single source of truth for this suite.
// `file` is relative to ROOT; `exp` is the named export; `props` are the
// props that exercise the *open* branch of prop-gated surfaces.
// ------------------------------------------------------------
const SCREENS = [
  // ---- core ----
  { id: 'ChatPanel', group: 'core', file: 'src/components/ChatPanel.tsx', exp: 'ChatPanel' },
  { id: 'Home', group: 'core', file: 'src/components/Home.tsx', exp: 'Home' },
  { id: 'Onboarding', group: 'core', file: 'src/components/Onboarding.tsx', exp: 'Onboarding', seed: { onboardingOpen: true } },
  { id: 'AuthScreen', group: 'core', file: 'src/components/AuthScreen.tsx', exp: 'AuthScreen' },
  { id: 'Welcome', group: 'core', file: 'src/components/Welcome.tsx', exp: 'Welcome' },
  { id: 'WhatsNew', group: 'core', file: 'src/components/WhatsNew.tsx', exp: 'WhatsNew', note: 'SSR no-op: visibility is set in useEffect (skipped by the server renderer)' },
  { id: 'CommandPalette', group: 'core', file: 'src/components/CommandPalette.tsx', exp: 'CommandPalette', props: { open: true, onClose() {} } },
  { id: 'SettingsModal', group: 'core', file: 'src/components/SettingsModal.tsx', exp: 'SettingsModal', seed: { settingsOpen: true, settingsSection: 'general' } },
  { id: 'DiffView', group: 'core', file: 'src/components/DiffView.tsx', exp: 'DiffView', props: { path: 'src/a.ts', oldText: 'const a = 1;\nold();\n', newText: 'const a = 2;\nnew();\n' } },
  { id: 'DiffModal', group: 'core', file: 'src/components/DiffModal.tsx', exp: 'DiffModal', seed: { diffView: { title: 'Review change', path: 'src/a.ts', oldText: 'const a = 1;\n', newText: 'const a = 2;\n', approvalRequestId: 'r1' } } },
  { id: 'EditorArea', group: 'core', file: 'src/components/EditorArea.tsx', exp: 'EditorArea' },

  // ---- rail panels (registry.tsx) ----
  { id: 'WorkspacePanel', group: 'rail', file: 'src/components/panels/WorkspacePanel.tsx', exp: 'WorkspacePanel' },
  { id: 'SessionsPanel', group: 'rail', file: 'src/components/panels/SessionsPanel.tsx', exp: 'SessionsPanel' },
  { id: 'GitPanel', group: 'rail', file: 'src/components/panels/GitPanel.tsx', exp: 'GitPanel' },
  { id: 'MCPPanel', group: 'rail', file: 'src/components/panels/MCPPanel.tsx', exp: 'MCPPanel' },
  { id: 'UsagePanel', group: 'rail', file: 'src/components/panels/UsagePanel.tsx', exp: 'UsagePanel' },
  { id: 'DnaPanel', group: 'rail', file: 'src/components/panels/DnaPanel.tsx', exp: 'DnaPanel' },
  { id: 'FlowsPanel', group: 'rail', file: 'src/components/panels/FlowsPanel.tsx', exp: 'FlowsPanel' },
  { id: 'SkillsPanel', group: 'rail', file: 'src/components/panels/SkillsPanel.tsx', exp: 'SkillsPanel', note: 'the founder-reported React #300 crash site' },
  { id: 'ArtifactsPanel', group: 'rail', file: 'src/components/panels/ArtifactsPanel.tsx', exp: 'ArtifactsPanel' },
  { id: 'LibraryPanel', group: 'rail', file: 'src/components/panels/LibraryPanel.tsx', exp: 'LibraryPanel' },
  { id: 'WikiPanel(via Library initialTab)', group: 'rail', file: 'src/components/panels/LibraryPanel.tsx', exp: 'LibraryPanel', props: { initialTab: 'wiki' } },
  { id: 'PromptsPanel', group: 'rail', file: 'src/components/panels/PromptsPanel.tsx', exp: 'PromptsPanel' },
  { id: 'SearchPanel', group: 'rail', file: 'src/components/SearchPanel.tsx', exp: 'SearchPanel' },
  { id: 'SubagentsPanel', group: 'rail', file: 'src/components/panels/SubagentsPanel.tsx', exp: 'SubagentsPanel' },
  { id: 'WikiPanel(component)', group: 'rail', file: 'src/components/panels/WikiPanel.tsx', exp: 'WikiPanel' },
  { id: 'SchedulePanel', group: 'rail', file: 'src/components/panels/SchedulePanel.tsx', exp: 'SchedulePanel' },
  { id: 'SecurityPanel', group: 'rail', file: 'src/components/panels/SecurityPanel.tsx', exp: 'SecurityPanel' },

  // ---- settings sections (SettingsModal.ActiveGroupBody) ----
  { id: 'GeneralSection', group: 'settings', file: 'src/components/settings/GeneralSection.tsx', exp: 'GeneralSection' },
  { id: 'AppearanceSection', group: 'settings', file: 'src/components/settings/AppearanceSection.tsx', exp: 'AppearanceSection' },
  { id: 'NotificationsSection', group: 'settings', file: 'src/components/settings/NotificationsSection.tsx', exp: 'NotificationsSection' },
  { id: 'VoiceSection', group: 'settings', file: 'src/components/settings/VoiceSection.tsx', exp: 'VoiceSection' },
  { id: 'AgentSection', group: 'settings', file: 'src/components/settings/AgentSection.tsx', exp: 'AgentSection' },
  { id: 'PrivacySection', group: 'settings', file: 'src/components/settings/PrivacySection.tsx', exp: 'PrivacySection' },
  { id: 'SkillsMemorySection', group: 'settings', file: 'src/components/settings/SkillsMemorySection.tsx', exp: 'SkillsMemorySection' },
  { id: 'ModelsSection', group: 'settings', file: 'src/components/settings/ModelsSection.tsx', exp: 'ModelsSection' },
  { id: 'ModelsSection(providersOnly)', group: 'settings', file: 'src/components/settings/ModelsSection.tsx', exp: 'ModelsSection', props: { providersOnly: true } },
  { id: 'McpSection', group: 'settings', file: 'src/components/settings/McpSection.tsx', exp: 'McpSection' },
  { id: 'PluginsSection', group: 'settings', file: 'src/components/settings/PluginsSection.tsx', exp: 'PluginsSection' },
  { id: 'ApiServerSection', group: 'settings', file: 'src/components/settings/ApiServerSection.tsx', exp: 'ApiServerSection' },
  { id: 'RemoteSection', group: 'settings', file: 'src/components/settings/RemoteSection.tsx', exp: 'RemoteSection' },
  { id: 'PreviewSection', group: 'settings', file: 'src/components/settings/PreviewSection.tsx', exp: 'PreviewSection' },
  { id: 'EditorSection', group: 'settings', file: 'src/components/settings/EditorSection.tsx', exp: 'EditorSection' },
  { id: 'TerminalSection', group: 'settings', file: 'src/components/settings/TerminalSection.tsx', exp: 'TerminalSection' },
  { id: 'GitWorktreeSection', group: 'settings', file: 'src/components/settings/GitWorktreeSection.tsx', exp: 'GitWorktreeSection' },
  { id: 'BillingSection', group: 'settings', file: 'src/components/settings/BillingSection.tsx', exp: 'BillingSection' },
  { id: 'ShortcutsSection', group: 'settings', file: 'src/components/settings/ShortcutsSection.tsx', exp: 'ShortcutsSection' },
  { id: 'EvidenceSection', group: 'settings', file: 'src/components/settings/EvidenceSection.tsx', exp: 'EvidenceSection' },
  { id: 'LogsSection', group: 'settings', file: 'src/components/settings/LogsSection.tsx', exp: 'LogsSection' },
  { id: 'UpdatesSection', group: 'settings', file: 'src/components/settings/UpdatesSection.tsx', exp: 'UpdatesSection' },
  { id: 'FeedbackSection', group: 'settings', file: 'src/components/settings/FeedbackSection.tsx', exp: 'FeedbackSection' },
  { id: 'AdvancedSection', group: 'settings', file: 'src/components/settings/AdvancedSection.tsx', exp: 'AdvancedSection' },
  { id: 'ApprovalsSection', group: 'settings', file: 'src/components/settings/ApprovalsSection.tsx', exp: 'ApprovalsSection' },
  { id: 'AccountAuthCard', group: 'settings', file: 'src/components/settings/AccountAuthCard.tsx', exp: 'AccountAuthCard' },
];

// ------------------------------------------------------------
// React #300 unstable-selector detection.
// A zustand selector that returns a fresh object/array on every call makes
// React 18.3 log: "The result of getSnapshot should be cached ... (#300)".
// We detect BOTH the source shape and the runtime console warning.
// ------------------------------------------------------------
const UNSTABLE_OBJECT = /useStore\s*\(\s*\(?\s*\w+\s*\)?\s*=>\s*\(\s*\{/g;
const UNSTABLE_ARRAY = /useStore\s*\(\s*\(?\s*\w+\s*\)?\s*=>\s*\[/g;
// A selector that derives a fresh collection on every call is equally unstable.
const UNSTABLE_DERIVED = /useStore\s*\(\s*\(?\s*\w+\s*\)?\s*=>[^\n;]{0,160}\?\.(?:filter|map|slice|flatMap|concat)\(|useStore\s*\(\s*\(?\s*\w+\s*\)?\s*=>[^\n;]{0,160}\.(?:filter|map|slice|flatMap|concat)\(/g;
const UNSTABLE_WARN = /getSnapshot should be cached|#300|maximum update depth|too many re-?renders/i;

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}
function scanUnstable(src) {
  const hits = [];
  for (const [re, kind] of [[UNSTABLE_OBJECT, 'object literal'], [UNSTABLE_ARRAY, 'array literal'], [UNSTABLE_DERIVED, 'fresh derived collection']]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      hits.push({ line: lineOf(src, m.index), kind, text: m[0].replace(/\s+/g, ' ') });
    }
  }
  return hits;
}

// ------------------------------------------------------------
// Dead-control detection (heuristic, deliberately conservative).
// A control is wired when it carries a DOM handler, is a submit button, or
// is intentionally disabled/read-only. Explicit empty handlers / TODOs are
// treated as dead.
// ------------------------------------------------------------
const HANDLER_RE = /\bon(?:Click|Change|Input|MouseDown|MouseUp|PointerDown|PointerUp|KeyDown|KeyUp|Submit|Blur|Focus|DoubleClick|TouchStart|ContextMenu)\s*=/i;
const NOOP_RE = /=\s*\{\s*(?:\(\s*\)\s*=>\s*\{\s*(?:\/\*[\s\S]*?\*\/)?\s*\}|undefined|null|noop|NOOP)\s*\}/i;
const TODO_RE = /\b(?:TODO|FIXME|not implemented|no-?op|unwired|do nothing)\b/i;
// Raw DOM controls plus the project's own interactive control components
// (settings/controls.tsx + ui.tsx) so "0 dead controls" is not a false green.
const TAG_RE = /<(button|Btn|IconBtn|IconButton|Toggle|Slider|Segmented|Select|TextInput|input|select|textarea)\b/gi;

function extractTag(src, start) {
  let quote = null;
  let brace = 0;
  let angle = 0; // generic type args, e.g. <Segmented<'a' | 'b'> ... />
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') { brace++; continue; }
    if (c === '}') { brace = Math.max(0, brace - 1); continue; }
    if (brace === 0 && c === '<') { angle++; continue; }
    if (c === '>' && brace === 0) {
      if (angle > 0) { angle--; continue; }
      return src.slice(start, i + 1);
    }
  }
  return src.slice(start, Math.min(start + 500, src.length));
}

function scanDeadControls(src, file) {
  const dead = [];
  let total = 0;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(src))) {
    total++;
    const start = m.index;
    const tag = extractTag(src, start);
    const line = lineOf(src, start);
    const isField = /^<(input|select|textarea|Toggle|Slider|Segmented|Select|TextInput)\b/i.test(tag);
    const hidden = /\btype\s*=\s*["'](?:hidden|submit|reset|button)["']/i.test(tag);
    const readOnly = /\breadOnly\b|\bdisabled\b/i.test(tag);
    const submit = /\btype\s*=\s*["']submit["']/i.test(tag);
    const wired = HANDLER_RE.test(tag);
    let reason = null;
    if (!wired && !submit && !hidden && !readOnly) {
      reason = isField ? 'no onChange/onClick' : 'no onClick/onChange';
    } else if (NOOP_RE.test(tag)) {
      reason = 'explicit empty/no-op handler';
    } else if (TODO_RE.test(tag)) {
      reason = 'handler references TODO/no-op';
    }
    if (reason) dead.push({ file, line, tag: tag.slice(0, 160).replace(/\s+/g, ' '), reason });
  }
  return { dead, total };
}

// ------------------------------------------------------------
// Harness state
// ------------------------------------------------------------
let React;
let renderToStaticMarkup;
let buildSeq = 0;
const bundleFiles = [];
const RESULTS = [];

// esbuild plugin: stub browser-only modules that cannot be required under SSR.
const stubPlugin = {
  name: 'sadeem-ssr-stubs',
  setup(build) {
    build.onResolve({ filter: /\?worker$/ }, (a) => ({ path: 'worker', namespace: 'ssm' }));
    build.onResolve({ filter: /(^|\/)lib\/monaco$/ }, () => ({ path: 'lib-monaco', namespace: 'ssm' }));
    build.onResolve({ filter: /^@monaco-editor\/react$/ }, () => ({ path: 'monaco-react', namespace: 'ssm' }));
    build.onResolve({ filter: /^lottie-web$/ }, () => ({ path: 'lottie', namespace: 'ssm' }));
    build.onResolve({ filter: /^qrcode$/ }, () => ({ path: 'qrcode', namespace: 'ssm' }));
    build.onLoad({ filter: /.*/, namespace: 'ssm' }, (a) => {
      let contents;
      switch (a.path) {
        case 'worker':
          contents = 'export default class SSMWorker {}'; break;
        case 'lib-monaco':
          contents = [
            "const monaco = { editor: { defineTheme() {}, createModel() {}, createDiffEditor() {} } };",
            "export { monaco };",
            "export const monacoThemeFor = () => 'surnia-dark';",
            "export const languageForPath = () => 'plaintext';",
          ].join('\n');
          break;
        case 'monaco-react':
          contents = [
            "const Nil = () => null;",
            "export const Editor = Nil;",
            "export const DiffEditor = Nil;",
            "export const loader = { config() {}, init() { return Promise.resolve({}); } };",
          ].join('\n');
          break;
        case 'lottie':
          contents = "export const loadAnimation = () => ({ destroy(){}, play(){}, stop(){}, goToAndStop(){} }); export default { loadAnimation };"; break;
        case 'qrcode':
          contents = "export const toDataURL = () => Promise.resolve('data:image/png;base64,'); export const toString = () => Promise.resolve(''); export default { toDataURL, toString };"; break;
        default:
          contents = 'export default null;';
      }
      return { contents, loader: 'js' };
    });
  },
};

const EXTERNALS = [
  'electron', 'react', 'react-dom', 'zustand', 'lucide-react',
  '@xterm/xterm', '@xterm/addon-fit',
];

function installBrowserStubs() {
  const bridge = new Proxy({}, {
    get(_t, key) {
      if (key === 'then' || key === 'toJSON' || typeof key === 'symbol') return undefined;
      return (..._args) => Promise.resolve(undefined);
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
    surnia: bridge,
    kodex: bridge,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    matchMedia: mq,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    location: { href: 'http://localhost/', reload() {} },
    navigator: { userAgent: 'node-ssr', clipboard: { writeText: () => Promise.resolve() } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    scrollTo() {}, alert() {}, confirm: () => true, prompt: () => null,
  };
  globalThis.document = {
    documentElement: el(), body: el(), head: el(),
    createElement: el, createElementNS: el, createTextNode: () => ({}),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    hidden: false, visibilityState: 'visible',
  };
  // Node 21+ exposes navigator/location as getter-only globals; redefine them.
  const def = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
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
  globalThis.WebSocket = class { constructor() {} send() {} close() {} addEventListener() {} removeEventListener() {} };
}

function seedStore(useStore, overrides = {}) {
  const prev = useStore.getState();
  const session = {
    id: 's1', title: 'Smoke session', workspace: 'D:\\ws', messages: [],
    createdAt: 1, updatedAt: 1, messageCount: 0, totalTokens: 0, totalCostUsd: 0,
  };
  useStore.setState({
    booted: true,
    settings: {
      ...prev.settings,
      language: 'en',
      lastSeenVersion: '0.0.0',
      model: { provider: 'custom', model: 'm' },
      providers: { ...(prev.settings?.providers ?? {}), custom: { apiKey: 'k', baseUrl: 'http://127.0.0.1:1' } },
      recentPaths: ['D:\\ws'],
    },
    wsPath: 'D:\\ws',
    session,
    sessions: [session],
    running: false,
    // FileNode is a SINGLE root node (see shared/types.ts), not an array.
    // AccountInfo must carry id/createdAt or AccountAuthCard crashes on
    // account.id.slice(...) — seed the real shape, not a convenient subset.
    account: { id: 'acct_smoke_0000000001', name: 'Smoke', email: 'smoke@example.test', createdAt: 1 },
    fileTree: {
      name: 'src', path: 'D:\\ws\\src', type: 'dir',
      children: [{ name: 'a.ts', path: 'D:\\ws\\src\\a.ts', type: 'file' }],
    },
    tabs: [{ path: 'src/a.ts', title: 'a.ts', content: 'const a = 1;\n', original: 'const a = 1;\n', dirty: false }],
    activeTab: 'src/a.ts',
    settingsOpen: false,
    onboardingOpen: false,
    paletteOpen: false,
    diffView: null,
    ...overrides,
  });
}

async function bundleScreen(screen) {
  // Bundles must live under the project root so externalized react/zustand/
  // lucide-react resolve from ROOT/node_modules (same pattern as the other
  // SSR suites in this repo). They are removed in after().
  const outfile = join(ROOT, 'tests', `.v1121-full-smoke-screen-${buildSeq++}.cjs`);
  const modPath = './' + screen.file.replace(/\.tsx?$/, '');
  const contents =
    "export { " + screen.exp + " as Component } from '" + modPath + "';\n" +
    "export { useStore } from './src/store';";
  await esbuild.build({
    // NOTE: do NOT set `sourcefile` here — esbuild then resolves the relative
    // stdin imports against that path's directory and silently drops exports.
    stdin: { contents, resolveDir: ROOT, loader: 'tsx' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    loader: {
      '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.jpg': 'empty',
      '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty', '.gif': 'empty',
    },
    external: EXTERNALS,
    plugins: [stubPlugin],
    logLevel: 'silent',
  });
  bundleFiles.push(outfile);
  return require(outfile);
}

function esbuildErr(err) {
  const detail = Array.isArray(err.errors)
    ? err.errors.map((e) => `${e.text}${e.location ? ` (${e.location.file}:${e.location.line})` : ''}`).join(' | ')
    : '';
  return `${err && err.message ? err.message : String(err)}${detail ? ' :: ' + detail : ''}`;
}

/** Render one screen; returns a rich result object instead of throwing for
 *  *environmental* failures so the report can distinguish CRASH vs UNTESTABLE. */
async function renderScreen(screen) {
  const out = {
    id: screen.id, group: screen.group, file: screen.file,
    status: 'UNTESTABLE', htmlLen: 0, unstable: [], dead: [], controlsScanned: 0, errors: [], notes: [],
  };
  if (screen.note) out.notes.push(screen.note);

  const abs = join(ROOT, screen.file);
  if (!existsSync(abs)) {
    out.errors.push(`source file missing: ${screen.file}`);
    return out;
  }
  const src = readFileSync(abs, 'utf8');
  out.unstable = scanUnstable(src);
  const controlScan = scanDeadControls(src, screen.file);
  out.dead = controlScan.dead;
  out.controlsScanned = controlScan.total;

  let mod;
  try {
    mod = await bundleScreen(screen);
  } catch (err) {
    out.errors.push(`BUNDLE: ${esbuildErr(err)}`);
    return out;
  }
  if (typeof mod.Component !== 'function' && typeof mod.Component !== 'object') {
    out.errors.push(`export "${screen.exp}" is not a component (got ${typeof mod.Component})`);
    return out;
  }
  seedStore(mod.useStore, screen.seed || {});

  const warnings = [];
  const origError = console.error;
  console.error = (...args) => { warnings.push(args.map(String).join(' ')); };
  let html;
  try {
    html = renderToStaticMarkup(React.createElement(mod.Component, screen.props || {}));
  } catch (err) {
    console.error = origError;
    const msg = err && err.message ? err.message : String(err);
    const stack = (err && err.stack ? String(err.stack) : '').split('\n').slice(1, 5).map((s) => s.trim()).join(' <- ');
    out.errors.push(`RENDER: ${msg}${stack ? ' :: ' + stack : ''}`);
    out.status = isEnvError(msg) ? 'UNTESTABLE' : 'CRASHES';
    out.warnings = warnings.filter((w) => UNSTABLE_WARN.test(w));
    return out;
  } finally {
    console.error = origError;
  }
  out.htmlLen = typeof html === 'string' ? html.length : 0;
  const badWarnings = warnings.filter((w) => UNSTABLE_WARN.test(w));
  if (badWarnings.length) out.errors.push(`RUNTIME #300: ${badWarnings[0].slice(0, 200)}`);
  if (out.unstable.length) out.errors.push(`UNSTABLE SELECTOR at line ${out.unstable.map((h) => h.line).join(',')}`);
  out.status = out.errors.length ? 'CRASHES' : 'RENDERS OK';
  if (!out.htmlLen) out.notes.push('SSR emitted no markup (surface gated behind useEffect/store flag)');
  return out;
}

function isEnvError(msg) {
  return /Cannot find module|Failed to resolve|Could not resolve|document is not defined|window is not defined|navigator is not defined|self is not defined|Worker is not defined|Not implemented: HTMLCanvasElement|WebGL/i.test(msg);
}

// ------------------------------------------------------------
before(() => {
  installBrowserStubs();
  React = require('react');
  // CRITICAL: zustand v5's getServerSnapshot reads getInitialState(), so SSR
  // would see the un-seeded store and render every gated surface as null.
  // Drop the third argument and force the LIVE snapshot instead (same trick
  // the other SSR suites in this repo use).
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  for (const f of bundleFiles) { try { unlinkSync(f); } catch { /* gone */ } }
  try { writeFileSync(RESULT_JSON, JSON.stringify(RESULTS, null, 2)); } catch { /* tmp gone */ }

  const ok = RESULTS.filter((r) => r.status === 'RENDERS OK').length;
  const crash = RESULTS.filter((r) => r.status === 'CRASHES').length;
  const unt = RESULTS.filter((r) => r.status === 'UNTESTABLE').length;
  const unstable = RESULTS.filter((r) => r.unstable.length);
  const withDead = RESULTS.filter((r) => r.dead.length);
  const controlsScanned = RESULTS.reduce((n, r) => n + r.controlsScanned, 0);
  const lines = [];
  lines.push('');
  lines.push('================ FULL SURFACE SMOKE — FINAL REPORT ================');
  lines.push(`SCREENS: ${RESULTS.length}   RENDERS OK: ${ok}   CRASHES: ${crash}   UNTESTABLE: ${unt}`);
  lines.push(`UNSTABLE SELECTORS: ${unstable.length} screen(s)   DEAD CONTROLS: ${withDead.reduce((n, r) => n + r.dead.length, 0)} across ${withDead.length} screen(s)   CONTROLS SCANNED: ${controlsScanned}`);
  for (const r of RESULTS) {
    lines.push(`  [${r.status.padEnd(10)}] ${r.id}${r.errors.length ? ' :: ' + r.errors.join(' | ') : ''}${r.dead.length ? ' :: DEAD:' + r.dead.length : ''}`);
  }
  const crashLines = [];
  for (const r of RESULTS) {
    for (const e of r.errors) crashLines.push(`${r.file} :: ${r.id} :: ${e}`);
    for (const h of r.unstable) crashLines.push(`${r.file}:${h.line} :: UNSTABLE ${h.kind} :: ${h.text}`);
    for (const d of r.dead) crashLines.push(`${d.file}:${d.line} :: DEAD CONTROL (${d.reason}) :: ${d.tag}`);
  }
  try { writeFileSync(CRASH_LOG, crashLines.join('\n')); } catch { /* tmp gone */ }
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
  // eslint-disable-next-line no-console
  console.log(`MACHINE RESULTS: ${RESULT_JSON}`);
  // eslint-disable-next-line no-console
  console.log(`FAILURE DETAIL:  ${CRASH_LOG}`);
  lines.forEach((l) => process.stdout.write('')); // keep linter quiet about unused
});

// ------------------------------------------------------------
// Harness sanity
// ------------------------------------------------------------
test('HARNESS: stubs + bundler + renderToStaticMarkup are usable', async () => {
  assert.equal(typeof renderToStaticMarkup, 'function');
  const probe = await bundleScreen({ file: 'src/components/Logo.tsx', exp: 'Logo', id: 'probe' });
  seedStore(probe.useStore);
  assert.equal(typeof probe.Component, 'function');
});

// ------------------------------------------------------------
// Every screen: render + React #300 detection.
// ------------------------------------------------------------
for (const screen of SCREENS) {
  test(`SSR: ${screen.group}/${screen.id}`, async () => {
    const r = await renderScreen(screen);
    RESULTS.push(r);
    assert.equal(
      r.status,
      'RENDERS OK',
      `${screen.id} :: ${screen.file}\n` +
        (r.errors.length ? '  errors: ' + r.errors.join('\n  ') : '') +
        (r.unstable.length ? '\n  unstable selectors: ' + r.unstable.map((h) => `${screen.file}:${h.line}`).join(', ') : ''),
    );
  });
}

// ------------------------------------------------------------
// Detector self-tests — prove the scanners actually fire (a green result
// with a dead detector would be a false green wash).
// ------------------------------------------------------------
test('DETECTORS: unstable-selector regex catches the React #300 shapes', () => {
  const cases = [
    'const x = useStore((s) => ({ a: s.a, b: s.b }));',
    'const x = useStore(s=> ({ a: s.a }));',
    'const x = useStore((state) => ({\n  a: state.a,\n}));',
    'const x = useStore((s) => [s.a, s.b]);',
    'const x = useStore((s) => s.items.filter((i) => i.ok));',
    'const x = useStore((s) => s.session?.messages.map(toRow));',
  ];
  for (const c of cases) assert.ok(scanUnstable(c).length > 0, `must flag: ${c}`);
  assert.equal(scanUnstable('const x = useStore((s) => s.a);').length, 0, 'stable scalar selector is clean');
  assert.equal(scanUnstable('const x = useStore((s) => s.session?.messages ?? NO_MESSAGES);').length, 0, 'stable constant fallback is clean');
});

test('DETECTORS: dead-control scanner sees wired, dead and no-op controls', () => {
  const src = [
    '<button onClick={() => doThing()}>OK</button>',
    '<button className="x">dead</button>',
    '<input value={v} onChange={(e) => setV(e.target.value)} />',
    '<input value={v} />',
    '<button onClick={() => {}}>noop</button>',
    '<button onClick={() => doIt() /* TODO */}>todo</button>',
    '<button type="submit">submit</button>',
  ].join('\n');
  const { dead, total } = scanDeadControls(src, 'synthetic.tsx');
  assert.equal(total, 7, 'all 7 controls were seen');
  assert.deepEqual(dead.map((d) => d.line), [2, 4, 5, 6], 'only dead/no-op controls flagged');
});

// ------------------------------------------------------------
// Hard gate: every control found on a smoke-tested screen must be wired.
// ------------------------------------------------------------
test('CONTROLS: no dead controls on any smoke-tested screen', (t) => {
  if (!RESULTS.length) { t.skip('SSR screens not executed (name filter active)'); return; }
  const dead = [];
  let seen = 0;
  for (const r of RESULTS) {
    seen += r.controlsScanned;
    for (const d of r.dead) dead.push(`${d.file}:${d.line} [${d.reason}] ${d.tag}`);
  }
  assert.ok(seen > 100, `expected a meaningful control sample, only scanned ${seen}`);
  assert.equal(dead.length, 0, `${dead.length} dead control(s):\n` + dead.join('\n'));
});

// ------------------------------------------------------------
// Registry coverage: every rail panel + every settings section is in SCREENS.
// ------------------------------------------------------------
test('COVERAGE: panel registry + settings registry are fully represented', () => {
  const panelSrc = readFileSync(join(ROOT, 'src/components/panels/registry.tsx'), 'utf8');
  const panelNames = [...panelSrc.matchAll(/panelOf\((\w+)Mod,\s*'(\w+)'\)/g)].map((m) => m[2]);
  for (const name of panelNames) {
    assert.ok(SCREENS.some((s) => s.exp === name), `panel registry entry "${name}" must be smoke-tested`);
  }
  const settingsSrc = readFileSync(join(ROOT, 'src/components/SettingsModal.tsx'), 'utf8');
  const sectionNames = [...settingsSrc.matchAll(/return <(\w+Section)[ />]/g)].map((m) => m[1]);
  const unique = [...new Set(sectionNames)];
  for (const name of unique) {
    assert.ok(SCREENS.some((s) => s.exp === name), `settings section "${name}" must be smoke-tested`);
  }
  assert.ok(panelNames.length >= 12, 'panel registry parsed');
  assert.ok(unique.length >= 20, 'settings sections parsed');
});

// ------------------------------------------------------------
// Global unstable-selector sweep across ALL of src (catches helpers imported
// by a screen even when the screen file itself is clean).
// ------------------------------------------------------------
test('GLOBAL: no unstable selector anywhere under src/', () => {
  const walk = (dir) => {
    const out = [];
    for (const e of readdirSafe(dir)) {
      const p = join(dir, e);
      if (e === 'node_modules' || e === 'dist' || e === 'build') continue;
      let st;
      try { st = require('node:fs').statSync(p); } catch { continue; }
      if (st.isDirectory()) out.push(...walk(p));
      else if (/\.(tsx?|jsx?)$/.test(e)) out.push(p);
    }
    return out;
  };
  const files = walk(join(ROOT, 'src'));
  const hits = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const h of scanUnstable(src)) hits.push(`${relative(ROOT, f)}:${h.line} (${h.kind}) ${h.text}`);
  }
  assert.equal(hits.length, 0, `Found ${hits.length} unstable selector(s):\n` + hits.join('\n'));
});

function readdirSafe(dir) {
  try { return require('node:fs').readdirSync(dir); } catch { return []; }
}
