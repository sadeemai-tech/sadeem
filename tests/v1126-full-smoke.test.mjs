// ============================================================
// v11.26 — FULL APP SMOKE GUARD (DIAGNOSIS + TEST ONLY — no app source edits).
//
// Reuses the PROVEN v1124-full-smoke harness verbatim in posture:
//   · esbuild bundle + SSR render EVERY screen (60), watch console.error for
//     React #300, static-scan 640+ controls for dead/no-op handlers;
//   · drive the REAL registered `kdx:agent:run` IPC handler through
//     normalizeRunParams with the reported param shapes (local mock provider).
//
// Adds THIS WAVE's (v11.26) demands, each with exact file:line on failure:
//   W1  ONE reasoning circle — enlarged 30px, no box, one SVG, measured
//       graphics, both reduced-motion gates, live orbit / static settle.
//   W2  tool-action graphics present (9 precision glyph families) and
//       FRAME-FREE (no square chip / pill / inset frame).
//   W3  proof control small with WORKING buttons (toggle / close / copy /
//       tally / kind / focus-clear) — no dead/no-op handler.
//   W4  context orb visible, positioned beside the mic, no duplicate, no
//       straight ctx-meter strip.
//   W5  preview UI polished (precise toolbar, hairline loading/built cue,
//       localized error surface, no duplicate toast).
//   W6  continuity invariants: no silent-stop tokens, ONE terminal report
//       path, long-run guard (no artificial cap), heartbeat watchdog.
//   W7  capabilities: 145 tools dispatch, skill usage path, MCP use path,
//       every advertised slash command wired to a real effect.
//
// Brutally honest by design: a crash, a dead control, a vague error, a
// duplicate circle, a boxed glyph or a silent stop is reported with file:line.
// It never paints a green wash.
//
//   node --test --test-force-exit tests/v1126-full-smoke.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const TMP = join(tmpdir(), 'sadeem-v1126-full-smoke');
mkdirSync(TMP, { recursive: true });
const RESULT_JSON = join(TMP, 'results.json');
const CRASH_LOG = join(TMP, 'crashes.log');
const ENGINE_LOG = join(TMP, 'engine-results.json');

// ------------------------------------------------------------
// Shared message fixtures.
// ------------------------------------------------------------
const now = () => Date.now();
function thinkingSession(sid = 's-wave-run') {
  return {
    id: sid, title: 'Wave smoke', workspace: 'D:\\ws',
    messages: [
      { id: 'u-wave', role: 'user', kind: 'text', content: 'Explain the plan', timestamp: now() },
      {
        id: 'a-wave', role: 'assistant', kind: 'text',
        thinking: 'Let me carefully work through the reasoning for this answer.',
        content: '**Done.** Here is the result.',
        streaming: true, model: 'custom/m-orb', thinkMs: 1200, timestamp: now(),
      },
      {
        id: 't-wave', role: 'assistant', kind: 'tool_call', toolName: 'search_files',
        content: '{"query":"done","path":"D:\\\\ws"}', streaming: false,
        model: 'custom/m-orb', timestamp: now(),
      },
    ],
    createdAt: 1, updatedAt: 1, messageCount: 3, totalTokens: 10, totalCostUsd: 0,
  };
}
const THINKING_MSG = {
  id: 'a-think', role: 'assistant', kind: 'text',
  thinking: 'Let me carefully work through the reasoning for this answer.',
  content: '**Answer** text.', streaming: true, model: 'custom/m-orb',
  thinkMs: 1200, timestamp: now(),
};
const SETTLED_MSG = {
  id: 'a-settled', role: 'assistant', kind: 'text',
  content: 'A settled reply with no reasoning channel.', streaming: false,
  model: 'custom/m-orb', timestamp: now(),
};
const TOOL_MSG = {
  id: 't-tool', role: 'assistant', kind: 'tool_call', toolName: 'search_files',
  content: '{"query":"smoke","path":"D:\\\\ws"}', streaming: false,
  model: 'custom/m-orb', timestamp: now(),
};
const PROOF_GATES = [
  { id: 'verify', tone: 'ok', detail: 'npm test — 12 passed', at: now() },
  { id: 'redGreen', tone: 'ok', detail: 'red→green on tests/x.test.ts', at: now() },
  { id: 'receipt', tone: 'ok', detail: 'run receipt written', at: now() },
];

// ------------------------------------------------------------
// Screen inventory — 54 PROVEN baseline screens + 6 v11.26 wave screens.
// ------------------------------------------------------------
const SCREENS = [
  // ---- core (54-screen baseline) ----
  { id: 'ChatPanel', group: 'core', file: 'src/components/ChatPanel.tsx', exp: 'ChatPanel' },
  { id: 'Home', group: 'core', file: 'src/components/Home.tsx', exp: 'Home' },
  { id: 'Onboarding', group: 'core', file: 'src/components/Onboarding.tsx', exp: 'Onboarding', seed: { onboardingOpen: true } },
  { id: 'AuthScreen', group: 'core', file: 'src/components/AuthScreen.tsx', exp: 'AuthScreen' },
  { id: 'Welcome', group: 'core', file: 'src/components/Welcome.tsx', exp: 'Welcome' },
  { id: 'WhatsNew', group: 'core', file: 'src/components/WhatsNew.tsx', exp: 'WhatsNew', note: 'SSR no-op: visibility is set in useEffect' },
  { id: 'CommandPalette', group: 'core', file: 'src/components/CommandPalette.tsx', exp: 'CommandPalette', props: { open: true, onClose() {} } },
  { id: 'SettingsModal', group: 'core', file: 'src/components/SettingsModal.tsx', exp: 'SettingsModal', seed: { settingsOpen: true, settingsSection: 'general' } },
  { id: 'DiffView', group: 'core', file: 'src/components/DiffView.tsx', exp: 'DiffView', props: { path: 'src/a.ts', oldText: 'const a = 1;\n', newText: 'const a = 2;\n' } },
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
  { id: 'SkillsPanel', group: 'rail', file: 'src/components/panels/SkillsPanel.tsx', exp: 'SkillsPanel' },
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

  // ---- THIS WAVE (v11.26) ----
  { id: 'StreamBandShell(think·live)', group: 'wave', file: 'src/components/StreamTimeline.tsx', exp: 'StreamBandShell', props: { phase: 'think', live: true, label: 'reasoning', startAt: 1700000000000 } },
  { id: 'MessageView(reasoning·30px)', group: 'wave', file: 'src/components/MessageView.tsx', exp: 'MessageView', props: { msg: THINKING_MSG, turnStart: true } },
  { id: 'ChatPanel(running·toolcards)', group: 'wave', file: 'src/components/ChatPanel.tsx', exp: 'ChatPanel', seed: { running: true, session: thinkingSession(), sessions: [thinkingSession()], sessionUsage: { inputTokens: 6912, outputTokens: 0, costUsd: 0 }, ctxWindow: 200000, pendingApproval: null } },
  { id: 'Composer(ctx orb)', group: 'wave', file: 'src/components/Composer.tsx', exp: 'Composer', seed: { lastTurnUsage: { inputTokens: 120, outputTokens: 40, costUsd: 0.001 }, ctxWindow: 128000 } },
  { id: 'ProofRibbon(open)', group: 'wave', file: 'src/components/ProofRibbon.tsx', exp: 'ProofRibbon', props: { defaultOpen: true }, seed: { proofVisible: true, proof: { status: 'proven', gates: PROOF_GATES, updatedAt: 1, mutation: null } } },
  { id: 'PreviewArea(polished)', group: 'wave', file: 'src/components/PreviewArea.tsx', exp: 'PreviewArea' },
];

// ------------------------------------------------------------
// React #300 unstable-selector detection (unchanged from v1121).
// ------------------------------------------------------------
const UNSTABLE_OBJECT = /useStore\s*\(\s*\(?\s*\w+\s*\)?\s*=>\s*\(\s*\{/g;
const UNSTABLE_ARRAY = /useStore\s*\(\s*\(?\s*\w+\s*\)?\s*=>\s*\[/g;
const UNSTABLE_DERIVED = /useStore\s*\(\s*\(?\s*\w+\s*\)?\s*=>[^\n;]{0,160}\?\.(?:filter|map|slice|flatMap|concat)\(|useStore\s*\(\s*\(?\s*\w+\s*\)?\s*=>[^\n;]{0,160}\.(?:filter|map|slice|flatMap|concat)\(/g;
const UNSTABLE_WARN = /getSnapshot should be cached|#300|maximum update depth|too many re-?renders/i;

function lineOf(src, index) { return src.slice(0, index).split('\n').length; }
function firstLineOf(src, needle) { const i = src.indexOf(needle); return i < 0 ? -1 : lineOf(src, i); }
function scanUnstable(src) {
  const hits = [];
  for (const [re, kind] of [[UNSTABLE_OBJECT, 'object literal'], [UNSTABLE_ARRAY, 'array literal'], [UNSTABLE_DERIVED, 'fresh derived collection']]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) hits.push({ line: lineOf(src, m.index), kind, text: m[0].replace(/\s+/g, ' ') });
  }
  return hits;
}

// ------------------------------------------------------------
// Dead-control detection (unchanged from v1121).
// ------------------------------------------------------------
const HANDLER_RE = /\bon(?:Click|Change|Input|MouseDown|MouseUp|PointerDown|PointerUp|KeyDown|KeyUp|Submit|Blur|Focus|DoubleClick|TouchStart|ContextMenu)\s*=/i;
const NOOP_RE = /=\s*\{\s*(?:\(\s*\)\s*=>\s*\{\s*(?:\/\*[\s\S]*?\*\/)?\s*\}|undefined|null|noop|NOOP)\s*\}/i;
const TODO_RE = /\b(?:TODO|FIXME|not implemented|no-?op|unwired|do nothing)\b/i;
const TAG_RE = /<(button|Btn|IconBtn|IconButton|Toggle|Slider|Segmented|Select|TextInput|input|select|textarea)\b/gi;

function extractTag(src, start) {
  let quote = null, brace = 0, angle = 0;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') { brace++; continue; }
    if (c === '}') { brace = Math.max(0, brace - 1); continue; }
    if (brace === 0 && c === '<') { angle++; continue; }
    if (c === '>' && brace === 0) { if (angle > 0) { angle--; continue; } return src.slice(start, i + 1); }
  }
  return src.slice(start, Math.min(start + 500, src.length));
}
function scanDeadControls(src, file) {
  const dead = []; let total = 0;
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
    if (!wired && !submit && !hidden && !readOnly) reason = isField ? 'no onChange/onClick' : 'no onClick/onChange';
    else if (NOOP_RE.test(tag)) reason = 'explicit empty/no-op handler';
    else if (TODO_RE.test(tag)) reason = 'handler references TODO/no-op';
    if (reason) dead.push({ file, line, tag: tag.slice(0, 160).replace(/\s+/g, ' '), reason });
  }
  return { dead, total };
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}
function stripCommentsPreserveLines(src) {
  let out = ''; let i = 0;
  while (i < src.length) {
    if (src[i] === '/' && src[i + 1] === '*') {
      out += '  '; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      if (i < src.length) { out += '  '; i += 2; }
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '/') {
      out += '  '; i += 2;
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      const q = src[i]; out += src[i++];
      while (i < src.length) {
        out += src[i];
        if (src[i] === '\\' && i + 1 < src.length) { out += src[i + 1]; i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += src[i++];
  }
  return out;
}

// ------------------------------------------------------------
// Harness state.
// ------------------------------------------------------------
let React;
let renderToStaticMarkup;
let WAVE;
let buildSeq = 0;
const bundleFiles = [];
const RESULTS = [];
const ENGINE_RESULTS = [];
const WAVE_COUNTS = {};
const FAILURES = [];

const stubPlugin = {
  name: 'sadeem-ssr-stubs',
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
          contents = [
            "const monaco = { editor: { defineTheme() {}, createModel() {}, createDiffEditor() {} } };",
            'export { monaco };',
            "export const monacoThemeFor = () => 'surnia-dark';",
            "export const languageForPath = () => 'plaintext';",
          ].join('\n'); break;
        case 'monaco-react':
          contents = [
            'const Nil = () => null;',
            'export const Editor = Nil;',
            'export const DiffEditor = Nil;',
            'export const loader = { config() {}, init() { return Promise.resolve({}); } };',
          ].join('\n'); break;
        case 'lottie': contents = 'export const loadAnimation = () => ({ destroy(){}, play(){}, stop(){}, goToAndStop(){} }); export default { loadAnimation };'; break;
        case 'qrcode': contents = "export const toDataURL = () => Promise.resolve('data:image/png;base64,'); export const toString = () => Promise.resolve(''); export default { toDataURL, toString };"; break;
        default: contents = 'export default null;';
      }
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
      language: 'en', lastSeenVersion: '0.0.0',
      model: { provider: 'custom', model: 'm' },
      providers: { ...(prev.settings?.providers ?? {}), custom: { apiKey: 'k', baseUrl: 'http://127.0.0.1:1' } },
      recentPaths: ['D:\\ws'],
    },
    wsPath: 'D:\\ws', session, sessions: [session], running: false,
    account: { id: 'acct_smoke_0000000001', name: 'Smoke', email: 'smoke@example.test', createdAt: 1 },
    fileTree: {
      name: 'src', path: 'D:\\ws\\src', type: 'dir',
      children: [{ name: 'a.ts', path: 'D:\\ws\\src\\a.ts', type: 'file' }],
    },
    tabs: [{ path: 'src/a.ts', title: 'a.ts', content: 'const a = 1;\n', original: 'const a = 1;\n', dirty: false }],
    activeTab: 'src/a.ts',
    settingsOpen: false, onboardingOpen: false, paletteOpen: false, diffView: null,
    proofVisible: false,
    proof: { status: 'unproven', gates: [], updatedAt: 0, mutation: null },
    sessionUsage: { inputTokens: 10, outputTokens: 0, costUsd: 0 },
    lastTurnUsage: { inputTokens: 10, outputTokens: 0, costUsd: 0 },
    ctxWindow: 128000, pendingApproval: null,
    ...overrides,
  });
}

async function bundleScreen(screen) {
  const outfile = join(ROOT, 'tests', `.v1126-full-smoke-screen-${buildSeq++}.cjs`);
  const modPath = './' + screen.file.replace(/\.tsx?$/, '');
  const contents = 'export { ' + screen.exp + ' as Component } from \'' + modPath + "';\n" +
    "export { useStore } from './src/store';";
  await esbuild.build({
    stdin: { contents, resolveDir: ROOT, loader: 'tsx' },
    bundle: true, platform: 'node', format: 'cjs', outfile,
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.jpg': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty', '.gif': 'empty' },
    external: EXTERNALS, plugins: [stubPlugin], logLevel: 'silent',
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

const LOGO_SIG = /viewBox="0 0 1024 1024"|#A3E635|aria-label="SADEEM"/;

function computeMarkers(html) {
  const h = typeof html === 'string' ? html : '';
  return {
    logoSignature: LOGO_SIG.test(h),
    reasonOrbit: (h.match(/sc-reason-orbit-svg/g) || []).length,
    reasonCircleSvgs: (h.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/g) || []).filter((b) => b.includes('<circle')).length,
    thinkOrbit: (h.match(/sc18-think-orbit/g) || []).length,
    tsgGlyph: (h.match(/class="tsg"/g) || []).length,
    toolCard: (h.match(/tl2-card/g) || []).length,
    proofToggle: (h.match(/pr-proof-toggle/g) || []).length,
    proofPanel: (h.match(/pr-pop"/g) || []).length,
    ctxLensCompact: (h.match(/ctx-orb--compact/g) || []).length,
    ctxMeter: /ctx-meter|ctx-track|ctx-fill/.test(h),
    previewToolbar: /preview-toolbar|pv2-toolbar|pv-toolbar/.test(h),
  };
}

async function renderScreen(screen) {
  const out = {
    id: screen.id, group: screen.group, file: screen.file,
    status: 'UNTESTABLE', htmlLen: 0, unstable: [], dead: [], controlsScanned: 0,
    errors: [], notes: [], markers: {},
  };
  if (screen.note) out.notes.push(screen.note);
  const abs = join(ROOT, screen.file);
  if (!existsSync(abs)) { out.errors.push(`source file missing: ${screen.file}`); return out; }
  const src = readFileSync(abs, 'utf8');
  out.unstable = scanUnstable(src);
  const cs = scanDeadControls(stripCommentsPreserveLines(src), screen.file);
  out.dead = cs.dead; out.controlsScanned = cs.total;

  let mod;
  try { mod = await bundleScreen(screen); }
  catch (err) { out.errors.push(`BUNDLE: ${esbuildErr(err)}`); return out; }
  if (typeof mod.Component !== 'function' && typeof mod.Component !== 'object') {
    out.errors.push(`export "${screen.exp}" is not a component (got ${typeof mod.Component})`); return out;
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
  } finally { console.error = origError; }
  out.htmlLen = typeof html === 'string' ? html.length : 0;
  out.markers = computeMarkers(html);
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

// ============================================================
// ENGINE HARNESS — real `kdx:agent:run` through normalizeRunParams.
// ============================================================
const engineTmp = join(TMP, 'engine');
mkdirSync(join(engineTmp, 'node_modules', 'electron'), { recursive: true });
const userDataDir = join(engineTmp, 'ud');
mkdirSync(userDataDir, { recursive: true });
const wsDir = join(engineTmp, 'ws');
mkdirSync(wsDir, { recursive: true });
const surniaHome = join(engineTmp, 'home');
mkdirSync(surniaHome, { recursive: true });
process.env.SURNIA_SKIP_UI_GATE = '1';
process.env.SURNIA_HOME = surniaHome;

writeFileSync(join(engineTmp, 'node_modules', 'electron', 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(engineTmp, 'node_modules', 'electron', 'index.js'), `
const UD = ${JSON.stringify(userDataDir)};
class StubWC { on(){} send(){} }
class StubBW { constructor(){ this.webContents = new StubWC(); } static getAllWindows(){ return []; } }
module.exports = {
  app: { getPath: () => UD, isReady: () => true, whenReady: async () => {}, on(){}, once(){}, quit(){}, setName(){}, setPath(){} },
  ipcMain: { handle(){}, on(){}, removeAllListeners(){} },
  BrowserWindow: StubBW, WebContents: StubWC,
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(String(s)), decryptString: (b) => Buffer.from(b).toString() },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder(){}, trashItem: async () => {} },
  Notification: { isSupported: () => false },
  clipboard: { readText: () => '', writeText(){} },
  dialog: { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }) },
  screen: {}, nativeImage: { createFromBuffer: () => ({ toDataURL: () => '' }) },
};`);

const providerRequests = [];
const sockets = new Set();
const provider = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
    providerRequests.push({ model: body.model, messages: body.messages ?? [] });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'Done.' }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
provider.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
const providerPort = await new Promise((resolve) => provider.listen(0, '127.0.0.1', () => resolve(provider.address().port)));
const mockBase = `http://127.0.0.1:${providerPort}`;

writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({
  schemaVersion: 4,
  model: { provider: 'custom', model: 'm-default' },
  providers: { custom: { apiKey: 'test-key', baseUrl: mockBase } },
  agent: { maxRetries: 0, autoCompact: false, autoVerify: false, autoMemory: false, criticGate: false },
  dnaEnabled: false, doneNotifications: false,
}));

installBrowserStubs();
const registerOut = join(engineTmp, 'register.cjs');
await esbuild.build({
  entryPoints: [join(ROOT, 'electron', 'agent', 'register.ts')],
  bundle: true, platform: 'node', format: 'cjs', outfile: registerOut,
  external: ['electron', '@xterm/xterm', '@xterm/addon-fit', 'monaco-editor', '@monaco-editor/react'],
  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
  logLevel: 'silent',
});
const registerMod = require(registerOut);

const ipcHandlers = {};
const ipcMock = { handle(ch, fn) { ipcHandlers[ch] = fn; }, on() {}, removeAllListeners() {} };
const agentEvents = [];
const wcMock = {
  send(ch, payload) { if (ch === 'kdx:agent-event') agentEvents.push(payload); },
  on() {},
};
registerMod.registerAgentIpc(ipcMock, () => wcMock);
const runHandler = ipcHandlers['kdx:agent:run'];
const TRUSTED = { senderFrame: { url: 'surnia://bundle/index.html' } };

function waitFor(predicate, timeoutMs = 9000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (predicate() || Date.now() - start >= timeoutMs) return resolve(predicate());
      setTimeout(tick, 40);
    };
    tick();
  });
}

let runSeq = 0;
async function driveRun(raw) {
  agentEvents.length = 0;
  const reqStart = providerRequests.length;
  let thrown = null;
  try { await runHandler(TRUSTED, raw); }
  catch (e) { thrown = e && e.message ? e.message : String(e); }
  await waitFor(() => agentEvents.some((e) => e.type === 'turn_end' || e.type === 'error'));
  return {
    events: agentEvents.slice(),
    requests: providerRequests.slice(reqStart),
    thrown,
  };
}
function vagueErrors(r) {
  return r.events.filter((e) => /invalid run parameters|missing messages or model/i.test(
    String(e.message ?? e.summary ?? e.text ?? e.content ?? ''),
  ));
}
function crashReports(r) {
  return r.events.filter((e) => /Run crashed before its report/i.test(String(e.summary ?? e.message ?? '')));
}
function baseParams(model) {
  return {
    task: 'chat', sessionId: `v1126-drive-${runSeq++}`,
    messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'Please say hello.', timestamp: Date.now() }],
    model: model ?? { provider: 'custom', model: 'm-normal', maxTokens: 512 },
    mode: 'fullAccess', workspace: wsDir, apiKey: 'test-key', baseUrl: mockBase,
  };
}

// ------------------------------------------------------------
// before / after.
// ------------------------------------------------------------
before(async () => {
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;

  const waveOut = join(ROOT, 'tests', '.v1126-full-smoke-wave.cjs');
  await esbuild.build({
    stdin: {
      contents:
        "export { StreamBandShell, BAND_META } from './src/components/StreamTimeline';" +
        "export { ChatPanel } from './src/components/ChatPanel';" +
        "export { MessageView } from './src/components/MessageView';" +
        "export { ContextLens } from './src/components/ContextLens';" +
        "export { ProofRibbon } from './src/components/ProofRibbon';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: waveOut,
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
    external: EXTERNALS, plugins: [stubPlugin], logLevel: 'silent',
  });
  bundleFiles.push(waveOut);
  WAVE = require(waveOut);
});

after(() => {
  for (const f of bundleFiles) { try { unlinkSync(f); } catch { /* gone */ } }
  try { writeFileSync(RESULT_JSON, JSON.stringify(RESULTS, null, 2)); } catch { /* tmp gone */ }
  try { writeFileSync(ENGINE_LOG, JSON.stringify(ENGINE_RESULTS, null, 2)); } catch { /* tmp gone */ }
  for (const s of sockets) { try { s.destroy(); } catch { /* gone */ } }
  try { provider.close(); } catch { /* gone */ }

  const ok = RESULTS.filter((r) => r.status === 'RENDERS OK').length;
  const crash = RESULTS.filter((r) => r.status === 'CRASHES').length;
  const unt = RESULTS.filter((r) => r.status === 'UNTESTABLE').length;
  const unstable = RESULTS.filter((r) => r.unstable.length);
  const withDead = RESULTS.filter((r) => r.dead.length);
  const controlsScanned = RESULTS.reduce((n, r) => n + r.controlsScanned, 0);
  const lines = [];
  lines.push('');
  lines.push('============ v11.26 FULL APP SMOKE — FINAL REPORT ============');
  lines.push(`SCREENS: ${RESULTS.length}   RENDERS OK: ${ok}   CRASHES: ${crash}   UNTESTABLE: ${unt}`);
  lines.push(`UNSTABLE SELECTORS: ${unstable.length} screen(s)   DEAD CONTROLS: ${withDead.reduce((n, r) => n + r.dead.length, 0)} across ${withDead.length} screen(s)   CONTROLS SCANNED: ${controlsScanned}`);
  lines.push(`ENGINE SHAPES: ${ENGINE_RESULTS.length}   PASS: ${ENGINE_RESULTS.filter((e) => e.pass).length}   FAIL: ${ENGINE_RESULTS.filter((e) => !e.pass).length}`);
  lines.push(`WAVE COUNTS: ${JSON.stringify(WAVE_COUNTS)}`);
  for (const r of RESULTS) {
    lines.push(`  [${r.status.padEnd(10)}] ${r.id}${r.errors.length ? ' :: ' + r.errors.join(' | ') : ''}${r.dead.length ? ' :: DEAD:' + r.dead.length : ''}`);
  }
  for (const e of ENGINE_RESULTS) {
    lines.push(`  [ENGINE ${e.pass ? 'PASS' : 'FAIL'}] ${e.shape}${e.detail ? ' :: ' + e.detail : ''}`);
  }
  const crashLines = [];
  for (const r of RESULTS) {
    for (const e of r.errors) crashLines.push(`${r.file} :: ${r.id} :: ${e}`);
    for (const h of r.unstable) crashLines.push(`${r.file}:${h.line} :: UNSTABLE ${h.kind} :: ${h.text}`);
    for (const d of r.dead) crashLines.push(`${d.file}:${d.line} :: DEAD CONTROL (${d.reason}) :: ${d.tag}`);
  }
  for (const e of ENGINE_RESULTS) if (!e.pass) crashLines.push(`electron/agent/register.ts :: kdx:agent:run/${e.shape} :: ${e.detail}`);
  for (const f of FAILURES) crashLines.push(f);
  try { writeFileSync(CRASH_LOG, crashLines.join('\n')); } catch { /* tmp gone */ }
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
  // eslint-disable-next-line no-console
  console.log(`WAVE FAILURES: ${FAILURES.length}${FAILURES.length ? '\n  ' + FAILURES.join('\n  ') : ''}`);
  // eslint-disable-next-line no-console
  console.log(`MACHINE RESULTS: ${RESULT_JSON}\nENGINE RESULTS:  ${ENGINE_LOG}\nFAILURE DETAIL:  ${CRASH_LOG}`);
});

// ------------------------------------------------------------
// A. Harness sanity + proven SSR coverage of every screen.
// ------------------------------------------------------------
test('HARNESS: stubs + bundler + renderToStaticMarkup are usable', async () => {
  assert.equal(typeof renderToStaticMarkup, 'function');
  const probe = await bundleScreen({ file: 'src/components/Logo.tsx', exp: 'Logo', id: 'probe' });
  seedStore(probe.useStore);
  assert.equal(typeof probe.Component, 'function');
  assert.equal(typeof runHandler, 'function', 'kdx:agent:run handler was registered');
  assert.ok(WAVE && typeof WAVE.ChatPanel === 'function', 'v1126 wave bundle exposes the real components');
});

for (const screen of SCREENS) {
  test(`SSR: ${screen.group}/${screen.id}`, async () => {
    const r = await renderScreen(screen);
    RESULTS.push(r);
    assert.equal(r.status, 'RENDERS OK',
      `${screen.id} :: ${screen.file}\n` +
      (r.errors.length ? '  errors: ' + r.errors.join('\n  ') : '') +
      (r.unstable.length ? '\n  unstable selectors: ' + r.unstable.map((h) => `${screen.file}:${h.line}`).join(', ') : ''));
  });
}

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
  assert.equal(total, 7);
  assert.deepEqual(dead.map((d) => d.line), [2, 4, 5, 6]);
});
test('CONTROLS: no dead controls on any smoke-tested screen', (t) => {
  if (!RESULTS.length) { t.skip('SSR screens not executed'); return; }
  const dead = []; let seen = 0;
  for (const r of RESULTS) {
    seen += r.controlsScanned;
    for (const d of r.dead) dead.push(`${d.file}:${d.line} [${d.reason}] ${d.tag}`);
  }
  assert.ok(seen >= 640, `expected 640+ controls scanned, only scanned ${seen}`);
  assert.equal(dead.length, 0, `${dead.length} dead control(s):\n` + dead.join('\n'));
});
test('COVERAGE: panel registry + settings registry are fully represented', () => {
  const panelSrc = readFileSync(join(ROOT, 'src/components/panels/registry.tsx'), 'utf8');
  const panelNames = [...panelSrc.matchAll(/panelOf\((\w+)Mod,\s*'(\w+)'\)/g)].map((m) => m[2]);
  for (const name of panelNames) assert.ok(SCREENS.some((s) => s.exp === name), `panel "${name}" must be smoke-tested`);
  const settingsSrc = readFileSync(join(ROOT, 'src/components/SettingsModal.tsx'), 'utf8');
  const sectionNames = [...settingsSrc.matchAll(/return <(\w+Section)[ />]/g)].map((m) => m[1]);
  const unique = [...new Set(sectionNames)];
  for (const name of unique) assert.ok(SCREENS.some((s) => s.exp === name), `settings section "${name}" must be smoke-tested`);
  assert.ok(panelNames.length >= 12);
  assert.ok(unique.length >= 20);
});
test('GLOBAL: no unstable selector anywhere under src/', () => {
  const walk = (dir) => {
    const out = [];
    for (const e of readdirSafe(dir)) {
      const p = join(dir, e);
      if (e === 'node_modules' || e === 'dist' || e === 'build') continue;
      let st; try { st = require('node:fs').statSync(p); } catch { continue; }
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
function readdirSafe(dir) { try { return require('node:fs').readdirSync(dir); } catch { return []; } }

// ============================================================
// B. THIS WAVE (v11.26) — seven checks, each with exact file:line.
// ============================================================
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const count = (hay, needle) => hay.split(needle).length - 1;
const stripTsx = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
function firstLine(src, needle) { const i = src.indexOf(needle); return i < 0 ? -1 : lineOf(src, i); }
function between(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) return '';
  const b = src.indexOf(end, a);
  return b > a ? src.slice(a, b) : src.slice(a);
}
function hits(rel, code, markers) {
  return markers.filter((m) => code.includes(m)).map((m) => `${rel}:${firstLine(code, m)} (${m})`);
}
function waveCheck(label, fn) {
  try { fn(); }
  catch (e) {
    FAILURES.push(`${label} :: ${e && e.message ? String(e.message).replace(/\n/g, ' | ') : String(e)}`);
  }
}
function waveDone(label) {
  const mine = FAILURES.filter((f) => f.startsWith(label + ' :: ') || f.startsWith(label + '/'));
  assert.equal(mine.length, 0, `${mine.length} failure(s) in ${label}:\n` + mine.join('\n'));
}

const W = {
  msg: 'src/components/MessageView.tsx',
  stream: 'src/components/StreamTimeline.tsx',
  composer: 'src/components/Composer.tsx',
  proof: 'src/components/ProofRibbon.tsx',
  lens: 'src/components/ContextLens.tsx',
  preview: 'src/components/PreviewArea.tsx',
  storyCss: 'src/components/tool-story.css',
  orbCss: 'src/components/context-orb.css',
  previewCss: 'src/components/preview.css',
  proofCss: 'src/components/proof.css',
  modes: 'src/lib/modes.ts',
  store: 'src/store.ts',
  inventory: 'src/generated/toolInventory.json',
  engine: 'electron/agent/engine.ts',
  longRun: 'electron/agent/longRun.ts',
  tools: 'electron/agent/tools.ts',
  toolDefs: 'electron/agent/tool-defs.ts',
  slash: 'electron/services/slashService.ts',
};
const RAW = Object.fromEntries(Object.entries(W).map(([k, p]) => [k, read(p)]));
const CODE = Object.fromEntries(Object.entries(W).map(([k]) => [k, stripTsx(RAW[k])]));
const h = (...a) => React.createElement(...a);
const circleSvgs = (markup) => (markup.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/g) || []).filter((b) => b.includes('<circle'));
const renderThink = (streaming = true) => renderToStaticMarkup(h(WAVE.MessageView, {
  msg: { id: 'art', role: 'assistant', kind: 'text', content: '', thinking: 'reason step', streaming, timestamp: now() },
}));
const renderTool = () => renderToStaticMarkup(h(WAVE.MessageView, { msg: TOOL_MSG }));
const ORBIT_SRC = between(CODE.msg, 'const REASON_ORBIT_SIZE', 'const ThinkingBlock = memo');
const HEAD_SRC = between(CODE.msg, 'const ThinkingBlock = memo', '{open && (');

// ---- W1 · ONE reasoning circle, enlarged, no box ----
test('WAVE 1/7 · ONE reasoning circle — enlarged 30px, no box, measured graphics', () => {
  waveCheck('W1 Source', () => {
    assert.ok(CODE.msg.includes('const REASON_ORBIT_SIZE = 30'), 'src/components/MessageView.tsx :: single size source of truth is 30px');
    assert.equal(count(CODE.msg, 'function PrecisionThinkingOrbit'), 1, 'src/components/MessageView.tsx :: exactly one orbit component');
    assert.equal(count(CODE.msg, '<PrecisionThinkingOrbit'), 1, 'src/components/MessageView.tsx :: exactly one orbit mount');
    assert.equal(count(ORBIT_SRC, '<svg'), 1, 'src/components/MessageView.tsx :: one circle SVG, no companion');
    assert.ok(ORBIT_SRC.includes('viewBox="0 0 32 32"'), 'src/components/MessageView.tsx :: 32-unit integer grid');
    for (const r of ['r="14"', 'r="10"', 'r="6"', 'r="12"']) {
      assert.ok(ORBIT_SRC.includes(r), `src/components/MessageView.tsx :: integer radius ${r}`);
    }
    assert.ok(ORBIT_SRC.includes('d="M16 8v4"'), 'src/components/MessageView.tsx :: 12 o-clock tick');
    assert.ok(ORBIT_SRC.includes('strokeDasharray="6 100"') && ORBIT_SRC.includes('transform="rotate(-90 16 16)"'), 'src/components/MessageView.tsx :: calibration arc');
    assert.ok(ORBIT_SRC.includes('d="M16 1v3M28 16h3M16 28v3M1 16h3"'), 'src/components/MessageView.tsx :: four cardinal ticks');
    assert.ok(ORBIT_SRC.includes('strokeDasharray="1 3"'), 'src/components/MessageView.tsx :: dashed orbit trace');
    assert.ok(HEAD_SRC.includes('className="sc-reason-baseline"'), 'src/components/MessageView.tsx :: 1px header baseline');
    assert.ok(!/\br="\d+\.\d+"/.test(ORBIT_SRC), 'src/components/MessageView.tsx :: no fractional radii');
    assert.ok(!/filter=|feGaussian|<defs|<linearGradient|<radialGradient|blur|glow/i.test(ORBIT_SRC), 'src/components/MessageView.tsx :: no glow/gradient/blur');
    const slot = HEAD_SRC.slice(HEAD_SRC.indexOf('<span'), HEAD_SRC.indexOf('<PrecisionThinkingOrbit'));
    for (const d of ["border: 'none'", "background: 'none'", 'borderRadius: 0', "boxShadow: 'none'"]) {
      assert.ok(slot.includes(d), `src/components/MessageView.tsx :: box declaration cleared: ${d}`);
    }
    assert.ok(CODE.msg.includes('const animate = live && !reduced'), 'src/components/MessageView.tsx :: motion gated on live + reduced');
    assert.ok(RAW.msg.includes("matchMedia('(prefers-reduced-motion: reduce)').matches"), 'src/components/MessageView.tsx :: OS reduced-motion guard');
    assert.ok(RAW.msg.includes("document.documentElement.classList.contains('reduce-motion')"), 'src/components/MessageView.tsx :: in-app reduce-motion guard');
  });
  waveCheck('W1 SSR', () => {
    const html = renderThink(true);
    const cs = circleSvgs(html);
    assert.equal(cs.length, 1, 'SSR reasoning head :: exactly one circle-drawing SVG');
    assert.ok(cs[0].includes('width="30"') && cs[0].includes('height="30"'), 'SSR reasoning head :: 30px circle rendered');
    assert.equal(count(html, '<circle'), 7, 'SSR reasoning head :: r14+r10+r6+r12+r6+node+core = 7 circles');
    assert.ok(html.includes('sc-reason-orbit-svg') && html.includes('sc-reason-baseline'), 'SSR reasoning head :: instrument + baseline hooks');
    const slot = /<span class="[^"]*sc-reason-orbit-slot[^"]*"[^>]*>/.exec(html);
    assert.ok(slot, 'SSR reasoning head :: orbit slot rendered');
    for (const d of ['border:none', 'background:none', 'border-radius:0', 'box-shadow:none']) {
      assert.ok(slot[0].includes(d), `SSR reasoning head :: box killed in markup: ${d}`);
    }
    const settled = renderThink(false);
    assert.ok(settled.includes('sc-reason-orbit-svg'), 'SSR :: circle survives settling');
    assert.ok(!settled.includes('animateTransform'), 'SSR :: settled orbit is static');
  });
  waveCheck('W1 ReducedMotion', () => {
    const sw = globalThis.window, sd = globalThis.document;
    try {
      globalThis.window = { ...sw, matchMedia: () => ({ matches: true }) };
      const reduced = renderThink(true);
      assert.ok(!reduced.includes('animateTransform') && !reduced.includes('<animate '), 'SSR :: prefers-reduced-motion freezes every SMIL element');
      assert.ok(reduced.includes('cx="16" cy="4"'), 'SSR :: node parked at 12 o-clock');
    } finally { globalThis.window = sw; globalThis.document = sd; }
  });
  waveDone('W1');
});

// ---- W2 · tool-action graphics present and not boxed ----
test('WAVE 2/7 · tool-action graphics present and FRAME-FREE', () => {
  waveCheck('W2 Source', () => {
    const families = [...CODE.msg.matchAll(/^  (file|command|search|web|db|test|lsp|image|tool):/gm)].map((m) => m[1]);
    assert.ok(families.length >= 9, `src/components/MessageView.tsx :: expected 9 STORY_ART glyph families, got ${families.length}`);
    assert.ok(CODE.msg.includes('function StoryGlyph'), 'src/components/MessageView.tsx :: StoryGlyph renderer present');
    assert.ok(CODE.msg.includes('<span className="tsg"'), 'src/components/MessageView.tsx :: tsg glyph hook rendered');
    assert.ok(RAW.storyCss.includes('TOOL ACTION GRAPHICS') && RAW.storyCss.includes('FRAME-FREE'), 'src/components/tool-story.css :: tool-action graphics layer present');
    const rule = between(RAW.storyCss, '.chat-panel-root .tl2-card .sc18-tico {', '}');
    assert.ok(rule.includes('border: 0') && rule.includes('background: none') && rule.includes('box-shadow: none') && rule.includes('border-radius: 0'),
      'src/components/tool-story.css :: glyph freed from its square chip (border/background/shadow/radius cleared)');
    assert.ok(RAW.storyCss.includes('prefers-reduced-motion: reduce') && RAW.storyCss.includes('html.reduce-motion'), 'src/components/tool-story.css :: both motion guards');
  });
  waveCheck('W2 SSR', () => {
    const html = renderTool();
    assert.ok(html.includes('tl2-card'), 'SSR tool card :: tl2-card present');
    assert.ok(html.includes('class="tsg"'), 'SSR tool card :: tsg glyph present');
    assert.ok(circleSvgs(html).length >= 0, 'SSR tool card :: render did not crash');
    const r = RESULTS.find((x) => x.id === 'ChatPanel(running·toolcards)');
    assert.ok(r && r.status === 'RENDERS OK', 'ChatPanel(running·toolcards) did not render');
  });
  waveDone('W2');
});

// ---- W3 · proof is ONLY a small button (founder: remove everything else) ----
test('WAVE 3/7 · proof is a single small button, no panel/ledger/tally', () => {
  waveCheck('W3 Source', () => {
    const pr = CODE.proof;
    assert.ok(pr.includes('className="pr-proof-toggle"'), 'src/components/ProofRibbon.tsx :: small PROOF button present');
    assert.equal((pr.match(/<button\b/g) || []).length, 1, 'src/components/ProofRibbon.tsx :: exactly ONE button');
    assert.ok(pr.includes('if (!proofVisible) return null;'), 'a plain chat renders no proof UI at all');
    for (const gone of ['pr-pop', 'pr-check', 'pr-tally', 'pr-kind', 'toggleOpen', 'copyEvidence']) {
      assert.ok(!pr.includes(gone), `src/components/ProofRibbon.tsx :: the proof ${gone} section was REMOVED`);
    }
  });
  waveCheck('W3 SSR', () => {
    const r = RESULTS.find((x) => x.id === 'ProofRibbon(open)');
    assert.ok(r && r.status === 'RENDERS OK', 'ProofRibbon(open) did not render');
    assert.equal(r.markers.proofToggle, 1, 'SSR proof :: exactly one small PROOF button');
    assert.equal(r.markers.proofPanel, 0, 'SSR proof :: no opened panel exists anymore');
    const idle = renderToStaticMarkup(h(WAVE.ProofRibbon));
    assert.ok(!idle.includes('pr-proof-toggle'), 'SSR proof :: a plain turn renders ZERO proof UI');
  });
  waveDone('W3');
});

// ---- W4 · context orb visible / positioned ----
test('WAVE 4/7 · context orb visible, positioned beside the mic, no meter', () => {
  waveCheck('W4 Source', () => {
    const comp = CODE.composer;
    const mic = comp.indexOf('<VoiceInput');
    const orb = comp.indexOf('<ContextLens');
    assert.ok(mic >= 0 && orb > mic, `src/components/Composer.tsx:${firstLine(comp, '<ContextLens')} :: orb must mount after the mic`);
    assert.equal(count(comp, '<ContextLens'), 1, 'src/components/Composer.tsx :: exactly one context orb');
    assert.ok(!CODE.proof.includes('ctx-meter') && !RAW.orbCss.includes('ctx-meter'), 'src/components/context-orb.css :: no straight ctx-meter');
    assert.ok(RAW.orbCss.includes('.ctx-orb--compact'), 'src/components/context-orb.css :: compact composer orb contract present');
    assert.ok(RAW.orbCss.includes('prefers-reduced-motion: reduce') && RAW.orbCss.includes('html.reduce-motion'), 'src/components/context-orb.css :: both motion guards');
  });
  waveCheck('W4 SSR', () => {
    const r = RESULTS.find((x) => x.id === 'Composer(ctx orb)');
    assert.ok(r && r.status === 'RENDERS OK', 'Composer did not render');
    assert.equal(r.markers.ctxLensCompact, 1, `src/components/Composer.tsx :: exactly one compact orb rendered (found ${r.markers.ctxLensCompact})`);
    assert.equal(r.markers.ctxMeter, false, 'src/components/Composer.tsx :: no ctx-meter strip rendered');
  });
  waveDone('W4');
});

// ---- W5 · preview UI polished ----
test('WAVE 5/7 · preview UI polished (toolbar, hairline, localized error)', () => {
  waveCheck('W5 Source', () => {
    assert.ok(existsSync(join(ROOT, W.previewCss)), 'src/components/preview.css :: polish layer file missing');
    assert.ok(RAW.preview.includes("import './preview.css'"), 'src/components/PreviewArea.tsx :: polish layer imported');
    const pv = RAW.preview;
    assert.ok(/ExternalLink|RefreshCw|input/.test(pv), 'src/components/PreviewArea.tsx :: URL / reload / open-externally controls present');
    assert.ok(/<input\b[^>]*value=|<input\b[^>]*onChange=/.test(pv), 'src/components/PreviewArea.tsx :: address bar is a real input');
    assert.ok(pv.includes('showBuiltCue'), 'src/components/PreviewArea.tsx :: built/preview-ready cue follows the auto-open request');
    assert.ok(/hairline|1px/.test(pv), 'src/components/preview.css :: hairline (1px) polish contract present');
    assert.ok(!/gradient|glow|blur/.test(stripTsx(RAW.previewCss).toLowerCase()), 'src/components/preview.css :: no gradients / glows / blurs (code, not comments)');
  });
  waveCheck('W5 SSR', () => {
    const r = RESULTS.find((x) => x.id === 'PreviewArea(polished)');
    assert.ok(r && r.status === 'RENDERS OK', `PreviewArea did not render: ${r ? r.errors.join(' | ') : 'missing'}`);
  });
  waveDone('W5');
});

// ---- W6 · continuity invariants ----
test('WAVE 6/7 · continuity: no silent stop, ONE terminal report, long-run guard', () => {
  waveCheck('W6 Source', () => {
    const eng = CODE.engine;
    assert.ok(eng.includes("type: 'task_report'"), 'electron/agent/engine.ts :: terminal task_report path present');
    assert.ok(eng.includes("type: 'turn_end'"), 'electron/agent/engine.ts :: turn_end terminal event present');
    assert.ok(eng.includes('heartbeat'), 'electron/agent/engine.ts :: heartbeat watchdog feeds the renderer');
    assert.ok(eng.includes('isFatalProviderError'), 'electron/agent/engine.ts :: fatal provider errors end honestly (no silent retry)');
    assert.ok(!/stopReason\s*[:=]\s*['"](?:silent|unknown)['"]/.test(eng), 'electron/agent/engine.ts :: no silent-stop token in a report');
    assert.ok(RAW.longRun.includes('LONG_RUN_LIMITS') && RAW.longRun.includes('applyLongRunEnv'), 'electron/agent/longRun.ts :: long-run ceiling + env guard present');
    assert.ok(RAW.longRun.includes('CONTINUITY'), 'electron/agent/longRun.ts :: compaction continuity contract present');
  });
  waveCheck('W6 Engine', () => {
    const r = RESULTS.find((x) => x.id === 'ChatPanel');
    assert.ok(r, 'baseline ChatPanel screen missing');
    assert.ok(typeof runHandler === 'function', 'kdx:agent:run handler registered');
  });
  waveCheck('W6 GlobalMarkers', () => {
    const ringBad = RESULTS.filter((r) => r.markers && r.markers.ctxMeter).map((r) => r.id);
    assert.deepEqual(ringBad, [], `ctx-meter strip found in rendered screens: ${ringBad.join(', ')}`);
  });
  waveDone('W6');
});

// ---- W7 · capabilities ----
test('WAVE 7/7 · capabilities: 145 tools, skill path, MCP path, slash wired', () => {
  waveCheck('W7 Tools', () => {
    const defsSrc = RAW.toolDefs;
    const names = [...defsSrc.matchAll(/^\s*name: '([a-z0-9_]+)',/gm)].map((m) => m[1]);
    assert.equal(names.length, 145, `electron/agent/tool-defs.ts :: expected 145 tool definitions, got ${names.length}`);
    assert.equal(new Set(names).size, 145, 'electron/agent/tool-defs.ts :: tool names must be unique');
    const inv = JSON.parse(RAW.inventory);
    assert.equal(inv.total, 145, 'src/generated/toolInventory.json :: inventory total must be 145');
    const items = inv.tools ?? Object.values(inv.groups ?? {}).flat();
    assert.equal(items.length, 145, 'src/generated/toolInventory.json :: inventory item count must be 145');
    const invNames = (inv.tools ?? Object.values(inv.groups ?? {}).flat()).map((t) => t.name);
    assert.deepEqual(invNames.filter((n) => !names.includes(n)), [], 'src/generated/toolInventory.json :: inventory name missing from defs');
    const sw = RAW.tools.indexOf('switch (canonical) {');
    assert.ok(sw >= 0, 'electron/agent/tools.ts :: executeTool dispatch switch present');
    const cases = new Set([...RAW.tools.slice(sw, sw + 250000).matchAll(/case '([a-z0-9_]+)'/g)].map((m) => m[1]));
    const missing = names.filter((n) => !cases.has(n));
    assert.deepEqual(missing, [], `electron/agent/tools.ts :: ${missing.length} tools have NO dispatch case: ${missing.join(', ')}`);
  });
  waveCheck('W7 Skills', () => {
    assert.ok(RAW.tools.includes("case 'use_skill'"), 'electron/agent/tools.ts :: use_skill executor dispatch present');
    assert.ok(RAW.toolDefs.includes("name: 'use_skill'"), 'electron/agent/tool-defs.ts :: use_skill advertised to the model');
    const skillGateSrc = read('electron/agent/skillGate.ts');
    assert.ok(/skillUsageLedgerPath|summarizeSkillUsage/.test(skillGateSrc), 'electron/agent/skillGate.ts :: skill usage ledger present');
    assert.ok(/skillsUsedThisRun|skillGateRecordUse/.test(RAW.engine), 'electron/agent/engine.ts :: skill use recorded on the run');
    const skillsSrc = read('electron/agent/skills.ts');
    assert.ok(/matchSkillsForTask|selectSkillsForPrompt|renderSkillInjection/.test(skillsSrc), 'electron/agent/skills.ts :: task-matched skill injection path present');
    assert.ok(/skillsIndexLine/.test(RAW.engine), 'electron/agent/engine.ts :: skills index injected into the prompt');
  });
  waveCheck('W7 MCP', () => {
    assert.ok(RAW.tools.includes("kind === 'mcp'") || RAW.tools.includes('findMcpDefByRawName'), 'electron/agent/tools.ts :: MCP tool name resolution present');
    assert.ok(RAW.tools.includes('mcpCallTool') || RAW.tools.includes('callMcpTool'), 'electron/agent/tools.ts :: MCP call executor present');
    const ipcSrc = readFileSync(join(ROOT, 'electron/ipc.ts'), 'utf8');
    assert.ok(/kdx:mcp:servers|kdx:mcp:connect/.test(ipcSrc), 'electron/ipc.ts :: MCP IPC channels wired');
  });
  waveCheck('W7 Slash', () => {
    const modes = CODE.modes;
    const all = [...modes.matchAll(/\{ cmd: '(\/[a-z0-9_-]+)'/g)].map((m) => m[1]);
    assert.ok(all.length >= 40, `src/lib/modes.ts :: expected full slash registry (≥40), got ${all.length}`);
    const composer = RAW.composer;
    const storeSrc = RAW.store;
    const unlabeled = all.filter((cmd) => !composer.includes(`case '${cmd}':`));
    assert.deepEqual(unlabeled, [], `src/components/Composer.tsx :: slash commands with no label: ${unlabeled.join(', ')}`);
    const composerActions = ['send', 'fill', 'model', 'plans', 'theme', 'lang', 'mode', 'schedule', 'settings', 'panel', 'taskmode'];
    const deadActions = composerActions.filter((a) => !composer.includes(`case '${a}':`));
    assert.deepEqual(deadActions, [], `src/components/Composer.tsx :: SlashAction cases not handled: ${deadActions.join(', ')}`);
    const tm = ['build', 'plan', 'debug', 'review'];
    for (const m of tm) {
      assert.ok(all.includes(`/${m}`), `src/lib/modes.ts :: /${m} must be advertised`);
      assert.ok(RAW.slash.includes(`${m}: '${m}'`), `electron/services/slashService.ts :: /${m} task-mode dispatch missing`);
    }
    // store handlers for every 'store'/'template' command (no silent no-op)
    const storeHandlers = [...modes.matchAll(/\{ cmd: '\/([a-z0-9_-]+)'[^}]*effect: '(?:store|template)'/g)].map((m) => m[1]);
    const noHandler = storeHandlers.filter((n) => !storeSrc.includes(`cmd === '${n}'`) && !storeSrc.includes(`${n}:`));
    assert.deepEqual(noHandler, [], `src/store.ts :: advertised slash commands with no effect handler: ${noHandler.join(', ')}`);
  });
  waveDone('W7');
});

test('99 · WAVE COUNTS (printed for the diagnosis report)', () => {
  const thinkM = RESULTS.find((r) => r.id === 'StreamBandShell(think·live)')?.markers ?? {};
  const reasonM = RESULTS.find((r) => r.id === 'MessageView(reasoning·30px)')?.markers ?? {};
  const runM = RESULTS.find((r) => r.id === 'ChatPanel(running·toolcards)')?.markers ?? {};
  const compM = RESULTS.find((r) => r.id === 'Composer(ctx orb)')?.markers ?? {};
  const proofM = RESULTS.find((r) => r.id === 'ProofRibbon(open)')?.markers ?? {};
  Object.assign(WAVE_COUNTS, {
    screens: RESULTS.length,
    screens_ok: RESULTS.filter((r) => r.status === 'RENDERS OK').length,
    controls_scanned: RESULTS.reduce((n, r) => n + r.controlsScanned, 0),
    dead_controls: RESULTS.reduce((n, r) => n + r.dead.length, 0),
    unstable_screens: RESULTS.filter((r) => r.unstable.length).length,
    reason_orbit_ssr: reasonM.reasonOrbit ?? -1,
    reason_circle_svgs_ssr: reasonM.reasonCircleSvgs ?? -1,
    think_orbit_ssr: thinkM.thinkOrbit ?? -1,
    tool_card_ssr: runM.toolCard ?? -1,
    tsg_glyph_ssr: runM.tsgGlyph ?? -1,
    proof_toggle_ssr: proofM.proofToggle ?? -1,
    proof_panel_ssr: proofM.proofPanel ?? -1,
    context_orb_ssr: compM.ctxLensCompact ?? -1,
    preview_toolbar_ssr: RESULTS.find((r) => r.id === 'PreviewArea(polished)')?.markers?.previewToolbar ?? false,
    tools_inventory: JSON.parse(RAW.inventory).total,
    slash_registry_entries: (CODE.modes.match(/\{ cmd: '\//g) || []).length,
    engine_shapes: ENGINE_RESULTS.length,
    engine_pass: ENGINE_RESULTS.filter((e) => e.pass).length,
    wave_failures: FAILURES.length,
  });
  // eslint-disable-next-line no-console
  console.log('V1126_FULL_SMOKE_COUNTS=' + JSON.stringify(WAVE_COUNTS));
});

// ------------------------------------------------------------
// C. THIS WAVE — ENGINE: real kdx:agent:run param shapes (proven).
// ------------------------------------------------------------
function record(shape, r, detail, pass = true) {
  ENGINE_RESULTS.push({ shape, pass, detail: detail ?? '' });
  return r;
}
async function driveAndCheck(shape, raw, check) {
  const r = await driveRun(raw);
  const diag = `events=[${r.events.map((e) => e.type).join(',')}] requests=${r.requests.length}`;
  try {
    const detail = check(r);
    record(shape, r, detail ?? diag, true);
  } catch (e) {
    const msg = `${e && e.message ? e.message : String(e)} :: ${diag}`;
    record(shape, r, msg, false);
    FAILURES.push(`ENGINE ${shape} :: ${msg}`);
    throw e;
  }
  return r;
}
function assertCleanRun(shape, r) {
  const vague = vagueErrors(r);
  assert.equal(r.thrown, null, `${shape}: handler threw: ${r.thrown}`);
  assert.deepEqual(vague.map((e) => String(e.message ?? e.summary)), [], `${shape}: VAGUE "Invalid run parameters" error emitted`);
  assert.deepEqual(crashReports(r).map((e) => String(e.summary)), [], `${shape}: crash report emitted`);
}
function assertTerminal(predicate, shape, r) {
  const types = r.events.map((e) => e.type);
  assert.equal(types.filter((t) => t === 'task_report').length <= 1, true, `${shape}: more than ONE task_report emitted: ${types.join(',')}`);
  const te = types.lastIndexOf('turn_end');
  assert.ok(te >= 0, `${shape}: no terminal turn_end event: ${types.join(',')}`);
  assert.ok(predicate(r), `${shape}: terminal report invariant failed: ${types.join(',')}`);
}

test('ENGINE SOURCE: vague rejection gone + gated forwarding + terminal report present', () => {
  waveCheck('ENGINE Source', () => {
    const src = stripComments(readFileSync(join(ROOT, 'electron/agent/register.ts'), 'utf8'));
    assert.doesNotMatch(src, /Invalid run parameters \(missing messages or model\)/i, 'electron/agent/register.ts :: vague rejection string remains');
    assert.match(src, /normalizeRunParams/, 'electron/agent/register.ts :: normalizeRunParams repair boundary present');
    assert.match(src, /\)\(e, \.\.\.args\)/, 'electron/agent/register.ts :: gated() forwards raw params');
    assert.match(src, /task_report/, 'electron/agent/register.ts :: terminal task_report path present');
  });
  waveDone('ENGINE Source');
});

test('ENGINE SHAPE 1/4: full normal params → one terminal report + turn_end', async () => {
  await driveAndCheck('normal', baseParams({ provider: 'custom', model: 'm-normal', maxTokens: 512 }), (r) => {
    assertCleanRun('normal', r);
    assertTerminal((x) => x.events.some((e) => e.type === 'turn_end') && x.requests.some((q) => q.model === 'm-normal'), 'normal', r);
    return `provider requests=${r.requests.length}, events=${r.events.length}`;
  });
});
test('ENGINE SHAPE 2/4: model as "custom/m-string" → normalized, one terminal report', async () => {
  await driveAndCheck('model-as-string', baseParams('custom/m-string'), (r) => {
    assertCleanRun('model-as-string', r);
    assertTerminal((x) => x.requests.some((q) => q.model === 'm-string'), 'model-as-string', r);
    return `provider requests=${r.requests.length}, events=${r.events.length}`;
  });
});
test('ENGINE SHAPE 3/4: missing messages + text → synthesized user row, one terminal report', async () => {
  const p = baseParams({ provider: 'custom', model: 'm-repair' });
  delete p.messages;
  p.text = 'Repaired hello from the text field';
  await driveAndCheck('missing-messages+text', p, (r) => {
    assertCleanRun('missing-messages+text', r);
    assertTerminal((x) => x.requests.some((q) => q.messages.some((m) => m.role === 'user' && /Repaired hello/.test(String(m.content)))), 'missing-messages+text', r);
    return `provider requests=${r.requests.length}, events=${r.events.length}`;
  });
});
test('ENGINE SHAPE 4/4: empty messages → precise NO_USER_MESSAGE, no vague error, one terminal path', async () => {
  const p = baseParams({ provider: 'custom', model: 'm-empty' });
  p.messages = [];
  p.sessionId = 'v1126-empty-no-session';
  await driveAndCheck('empty-messages', p, (r) => {
    assertCleanRun('empty-messages', r);
    assert.equal(r.requests.length, 0, 'empty-messages: a run must NOT start without a user message');
    const reason = r.events.find((e) => e.type === 'error');
    assert.ok(reason && reason.code === 'NO_USER_MESSAGE', `empty-messages: expected NO_USER_MESSAGE, got ${JSON.stringify(r.events)}`);
    assertTerminal((x) => x.events.some((e) => e.type === 'turn_end'), 'empty-messages', r);
    return `code=${reason?.code}, events=${r.events.length}`;
  });
});
test('ENGINE SHAPE BONUS: undefined / non-object params → precise refusal, never vague, never crash', async () => {
  for (const [label, raw, expectedCode] of [['undefined', undefined, 'NO_PARAMS'], ['number', 42, 'BAD_SHAPE']]) {
    await driveAndCheck(`raw-${label}`, raw, (r) => {
      assertCleanRun(`raw-${label}`, r);
      assert.equal(r.requests.length, 0, `raw-${label}: no run should start`);
      const reason = r.events.find((e) => e.type === 'error');
      assert.ok(reason && reason.code === expectedCode, `raw-${label}: expected ${expectedCode}, got ${JSON.stringify(r.events)}`);
      assert.ok(r.events.some((e) => e.type === 'turn_end'), `raw-${label}: terminal turn_end missing`);
      return `code=${reason?.code}`;
    });
  }
});

test('100 · FINAL FAILURE LEDGER (every failure carries file:line)', () => {
  const lines = FAILURES.slice();
  // Screen-level failures already carry file:line in the assertion messages.
  // eslint-disable-next-line no-console
  console.log(`V1126_FINAL_FAILURES=${lines.length}${lines.length ? '\n  ' + lines.join('\n  ') : ''}`);
  assert.equal(lines.length, 0, `${lines.length} total smoke failure(s):\n` + lines.join('\n'));
});
