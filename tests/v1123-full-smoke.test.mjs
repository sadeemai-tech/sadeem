// ============================================================
// v11.23 — FULL APP SMOKE GUARD (diagnosis + test ONLY).
//
// The v11.22 pass CLAIMED the circles + logo were fixed. The founder
// came back: they were NOT. This wave demands the REAL end state:
//   · NO app Logo beside THINK (StreamTimeline.ThinkBrand) or in any
//     live/reasoning position — the THINK band must be a SPINNING CIRCLE.
//   · NO duplicate "working" ring (ChatPanel.ChatLiveIndicator /
//     chat-live-ring / chat-live-dot) — delete it, not hide it.
//   · EXACTLY ONE primary circle (LiveThinkingPanel / cp-live-glyph).
//   · EXACTLY ONE context orb beside the mic (<ContextLens compact />).
//   · NO ctx-meter / ctx-track / ctx-fill strip anywhere.
// Plus the `kdx:agent:run` param-shape engine smoke (must never regress).
//
// This file NEVER edits application source. It does three things, loudly:
//   1. Reuses the PROVEN v1122-full-smoke harness: esbuild-bundle + SSR
//      render EVERY screen (all 54 baseline + MessageView/Composer/
//      ProofRibbon + a running ChatPanel + the THINK band), watch
//      console.error for React #300, and statically hunt dead controls.
//   2. Adds THIS WAVE's explicit render + source assertions (above).
//   3. Drives the REAL registered `kdx:agent:run` IPC handler through
//      normalizeRunParams with the reported param shapes and asserts:
//      no vague error, no crash, correct run start / precise refusal.
//
// Brutally honest by design: a crash, a dead control, a vague error, a
// stray logo or a duplicate circle is reported with an exact file:line.
// It never paints a green wash.
//
//   node --test --test-force-exit tests/v1123-full-smoke.test.mjs
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

const TMP = join(tmpdir(), 'sadeem-v1123-full-smoke');
mkdirSync(TMP, { recursive: true });
const RESULT_JSON = join(TMP, 'results.json');
const CRASH_LOG = join(TMP, 'crashes.log');
const ENGINE_LOG = join(TMP, 'engine-results.json');

// ------------------------------------------------------------
// Shared message fixtures for the wave's MessageView/ChatPanel screens.
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
    ],
    createdAt: 1, updatedAt: 1, messageCount: 2, totalTokens: 10, totalCostUsd: 0,
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

// ------------------------------------------------------------
// Screen inventory — the 54 PROVEN v1121 screens + 5 wave-specific ones.
// ------------------------------------------------------------
const SCREENS = [
  // ---- core (the 54-screen baseline) ----
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

  // ---- THIS WAVE (v11.23) — THINK circle, no logo/duplicate ring, one orb ----
  // The THINK band: must be a SPINNING CIRCLE, never the app Logo.
  { id: 'StreamBandShell(think·live)', group: 'wave', file: 'src/components/StreamTimeline.tsx', exp: 'StreamBandShell', props: { phase: 'think', live: true, label: 'reasoning', startAt: 1700000000000 } },
  { id: 'ChatPanel(running·circles)', group: 'wave', file: 'src/components/ChatPanel.tsx', exp: 'ChatPanel', seed: { running: true, session: thinkingSession(), sessions: [thinkingSession()] } },
  { id: 'MessageView(thinking·circles)', group: 'wave', file: 'src/components/MessageView.tsx', exp: 'MessageView', props: { msg: THINKING_MSG, turnStart: true } },
  { id: 'MessageView(settled)', group: 'wave', file: 'src/components/MessageView.tsx', exp: 'MessageView', props: { msg: SETTLED_MSG, turnStart: true } },
  // ContextLens returns null when hasData is false — seed a real last-turn
  // usage so the single compact orb actually mounts in the SSR snapshot.
  { id: 'Composer', group: 'wave', file: 'src/components/Composer.tsx', exp: 'Composer', seed: { lastTurnUsage: { inputTokens: 120, outputTokens: 40, costUsd: 0.001 }, ctxWindow: 128000 } },
  { id: 'ProofRibbon', group: 'wave', file: 'src/components/ProofRibbon.tsx', exp: 'ProofRibbon', seed: { proofVisible: false } },
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

// strip // and /* */ comments so source-name assertions don't false-positive
// on documentation that intentionally mentions the removed glyphs.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}
// Comment-aware stripper that PRESERVES line numbers and string literals —
// used for the dead-control scan so a comment saying "<button>" (e.g.
// ProofRibbon.tsx:454/:560) is not mistaken for an unwired control.
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
// Harness state
// ------------------------------------------------------------
let React;
let renderToStaticMarkup;
let buildSeq = 0;
const bundleFiles = [];
const RESULTS = [];
const ENGINE_RESULTS = [];
const WAVE_COUNTS = {};

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
    ...overrides,
  });
}

async function bundleScreen(screen) {
  const outfile = join(ROOT, 'tests', `.v1123-full-smoke-screen-${buildSeq++}.cjs`);
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

// The app Logo's immutable render signature (src/components/Logo.tsx).
const LOGO_SIG = /viewBox="0 0 1024 1024"|#A3E635|aria-label="SADEEM"/;

function computeMarkers(html) {
  const h = typeof html === 'string' ? html : '';
  return {
    reasonOrbit: /sc-think-engrave[\s\S]{0,400}sc-reason-orbit-svg|sc-reason-orbit-svg/.test(h),
    compactOrbit: /sc-think-orbit/.test(h),
    liveGlyph80: /cp-live-glyph[\s\S]{0,600}?width="80"/.test(h),
    orbit32: /viewBox="0 0 32 32"/.test(h),
    orbit24: /viewBox="0 0 24 24"/.test(h),
    ctxLensCompact: (h.match(/ctx-orb--compact/g) || []).length,
    ctxMeter: /ctx-meter|ctx-track|ctx-fill/.test(h),
    // ---- v11.23 wave markers ----
    logoSignature: LOGO_SIG.test(h),
    primaryGlyph: (h.match(/cp-live-glyph/g) || []).length,
    chatLiveRing: (h.match(/chat-live-ring/g) || []).length,
    chatLiveDot: (h.match(/chat-live-dot/g) || []).length,
    chatLiveChip: /class="chat-live"/.test(h),
    compactOrbitSvg: (h.match(/sc-think-orbit-svg/g) || []).length,
    thinkSpin: /type="rotate"/.test(h) && /to="360 /.test(h),
    thinkOrbit: /sc18-think-orbit/.test(h),
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
// Built at module load (top-level await), like v1121-modes-real.
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

// --- local mock OpenAI-compatible provider (zero real network) ---
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

// install the browser-ish globals the engine bundle may glance at, then bundle.
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

// capture the REAL registered handler through a recording ipc object.
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
  // Wait for a TERMINAL event so `turn_end` assertions are meaningful. Refusal
  // paths emit it synchronously; real runs emit it when the mock provider's
  // stream completes. Bounded by waitFor's timeout (never hangs the suite).
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
    task: 'chat', sessionId: `v1123-drive-${runSeq++}`,
    messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'Please say hello.', timestamp: Date.now() }],
    model: model ?? { provider: 'custom', model: 'm-normal', maxTokens: 512 },
    mode: 'fullAccess', workspace: wsDir, apiKey: 'test-key', baseUrl: mockBase,
  };
}

// ------------------------------------------------------------
// before / after
// ------------------------------------------------------------
before(() => {
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  // StreamBandShell reads layout/matchMedia during SSR; silence layout-effect
  // warnings the same way the proven graphics guard does.
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
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
  lines.push('============ v11.23 FULL APP SMOKE — FINAL REPORT ============');
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
  try { writeFileSync(CRASH_LOG, crashLines.join('\n')); } catch { /* tmp gone */ }
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
  // eslint-disable-next-line no-console
  console.log(`MACHINE RESULTS: ${RESULT_JSON}\nENGINE RESULTS:  ${ENGINE_LOG}\nFAILURE DETAIL:  ${CRASH_LOG}`);
  lines.forEach((l) => process.stdout.write(''));
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

// ------------------------------------------------------------
// B. Detector self-tests (prove the scanners actually fire).
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
test('CONTROLS: no dead controls on any smoke-tested screen', (t) => {
  if (!RESULTS.length) { t.skip('SSR screens not executed (name filter active)'); return; }
  const dead = []; let seen = 0;
  for (const r of RESULTS) {
    seen += r.controlsScanned;
    for (const d of r.dead) dead.push(`${d.file}:${d.line} [${d.reason}] ${d.tag}`);
  }
  assert.ok(seen > 100, `expected a meaningful control sample, only scanned ${seen}`);
  assert.equal(dead.length, 0, `${dead.length} dead control(s):\n` + dead.join('\n'));
});
test('COVERAGE: panel registry + settings registry are fully represented', () => {
  const panelSrc = readFileSync(join(ROOT, 'src/components/panels/registry.tsx'), 'utf8');
  const panelNames = [...panelSrc.matchAll(/panelOf\((\w+)Mod,\s*'(\w+)'\)/g)].map((m) => m[2]);
  for (const name of panelNames) assert.ok(SCREENS.some((s) => s.exp === name), `panel registry entry "${name}" must be smoke-tested`);
  const settingsSrc = readFileSync(join(ROOT, 'src/components/SettingsModal.tsx'), 'utf8');
  const sectionNames = [...settingsSrc.matchAll(/return <(\w+Section)[ />]/g)].map((m) => m[1]);
  const unique = [...new Set(sectionNames)];
  for (const name of unique) assert.ok(SCREENS.some((s) => s.exp === name), `settings section "${name}" must be smoke-tested`);
  assert.ok(panelNames.length >= 12, 'panel registry parsed');
  assert.ok(unique.length >= 20, 'settings sections parsed');
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

// ------------------------------------------------------------
// C. THIS WAVE (v11.23) — THINK circle, no logo/duplicate ring, one orb.
// Every source scan is COMMENT-FREE (a prior agent parked banned tokens in
// comments to game the guards). Failures carry exact file:line.
// ------------------------------------------------------------
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const count = (hay, needle) => hay.split(needle).length - 1;
function walkTsx(dir) {
  const out = [];
  for (const e of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkTsx(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}
const ALL_TSX = walkTsx(join(ROOT, 'src')).map((p) => ({
  file: p.slice(ROOT.length).replace(/\\/g, '/'),
  code: stripComments(readFileSync(p, 'utf8')),
}));
function markersOf(id) {
  const r = RESULTS.find((x) => x.id === id);
  assert.ok(r, `screen ${id} did not run`);
  assert.equal(r.status, 'RENDERS OK', `${id} did not render: ${r.errors.join(' | ')}`);
  return r.markers;
}

test('WAVE THINK: StreamTimeline source has NO Logo / ThinkBrand / brand:true', () => {
  const s = stripComments(read('src/components/StreamTimeline.tsx'));
  for (const tok of ['import { Logo }', '<Logo', 'ThinkBrand', 'brand: true']) {
    assert.equal(count(s, tok), 0,
      `src/components/StreamTimeline.tsx:${firstLineOf(s, tok)} :: banned token "${tok}" still present in THINK band source`);
  }
  assert.ok(!LOGO_SIG.test(s), 'src/components/StreamTimeline.tsx :: app-logo SVG signature (1024 grid / lime / aria-label) still present');
});

test('WAVE THINK: SSR THINK band is a spinning circle, carries no app logo', () => {
  const m = markersOf('StreamBandShell(think·live)');
  assert.ok(m.thinkOrbit, 'src/components/StreamTimeline.tsx :: SSR think band missing sc18-think-orbit circle');
  assert.ok(m.thinkSpin, 'src/components/StreamTimeline.tsx :: SSR think band missing rotate/to="360 " (not spinning)');
  assert.equal(m.logoSignature, false, 'src/components/StreamTimeline.tsx :: SSR think band carries the app logo signature');
});

test('WAVE DUPLICATE RING: ChatPanel source has NO ChatLiveIndicator / chat-live-*', () => {
  const c = stripComments(read('src/components/ChatPanel.tsx'));
  for (const tok of ['ChatLiveIndicator', 'chat-live-ring', 'chat-live-dot',
    'chat-live-label', 'chat-live-clock', 'chat-live-tok', 'className="chat-live"']) {
    assert.equal(count(c, tok), 0,
      `src/components/ChatPanel.tsx:${firstLineOf(c, tok)} :: duplicate live-ring token "${tok}" still present`);
  }
});

test('WAVE v11.24: the ONE live circle lives in the run strip, no big panel', () => {
  const c = stripComments(read('src/components/ChatPanel.tsx'));
  for (const tok of ['function LiveThinkingPanel', '<LiveThinkingPanel', 'cp-live-glyph', 'cp-live-panel']) {
    assert.equal(count(c, tok), 0, `the big standalone circle token "${tok}" is GONE`);
  }
  const start = c.indexOf('function RunStatusLine');
  const end = c.indexOf('\nfunction ', start + 1);
  const strip = c.slice(start, end < 0 ? undefined : end);
  assert.equal((strip.match(/<svg\b/g) || []).length, 1, 'exactly one inline SVG in the strip');
  assert.ok(strip.includes('sc-strip-orbit'), 'the single circle hook is inside the strip');
  const m = markersOf('ChatPanel(running·circles)');
  assert.equal(m.chatLiveRing, 0, 'no duplicate chat-live-ring');
  assert.equal(m.chatLiveDot, 0, 'no duplicate chat-live-dot');
});

test('WAVE NO LOGO IN LIVE/REASONING POSITIONS (source + SSR)', () => {
  const mv = stripComments(read('src/components/MessageView.tsx'));
  assert.equal(count(mv, '<Logo'), 0,
    `src/components/MessageView.tsx:${firstLineOf(mv, '<Logo')} :: no app logo allowed in a reasoning position`);
  const c = stripComments(read('src/components/ChatPanel.tsx'));
  assert.equal(count(c, '<Logo'), 1,
    `src/components/ChatPanel.tsx:${firstLineOf(c, '<Logo')} :: only the empty-state logo (size 40) is allowed`);
  assert.ok(c.includes('<Logo size={40} />'), 'src/components/ChatPanel.tsx :: empty-state logo size 40 must survive');
  assert.ok(!c.includes('<Logo size={12} />'), 'src/components/ChatPanel.tsx :: no small logo in the live strip');
  for (const id of ['StreamBandShell(think·live)', 'MessageView(thinking·circles)',
    'MessageView(settled)', 'ChatPanel(running·circles)']) {
    const m = markersOf(id);
    assert.equal(m.logoSignature, false, `${id} :: SSR markup carries the app logo signature in a live/reasoning position`);
  }
  // v11.24 — the row-orbit duplicate was DELETED; the reasoning head keeps one.
  const mm = markersOf('MessageView(thinking·circles)');
  assert.ok(mm.reasonOrbit && mm.orbit32, 'src/components/MessageView.tsx :: precision thinking orbit (32-grid) kept');
  assert.ok(!mm.compactOrbit, 'the duplicate compact row orbit is GONE');
});

test('WAVE COMPOSER: exactly one context orb beside the mic, no ctx-meter', () => {
  const comp = stripComments(read('src/components/Composer.tsx'));
  const mic = comp.indexOf('<VoiceInput');
  const orb = comp.indexOf('<ContextLens compact />');
  assert.ok(mic >= 0 && orb > mic,
    `src/components/Composer.tsx :: orb (line ${firstLineOf(comp, '<ContextLens')}) must mount after the mic (line ${firstLineOf(comp, '<VoiceInput')})`);
  assert.equal(count(comp, '<ContextLens'), 1,
    `src/components/Composer.tsx:${firstLineOf(comp, '<ContextLens')} :: exactly one context orb`);
  assert.ok(!stripComments(read('src/components/ChatPanel.tsx')).includes('<ContextLens'), 'src/components/ChatPanel.tsx :: no chat-header context duplicate');
  assert.ok(!stripComments(read('src/components/StatusBar.tsx')).includes('<ContextLens'), 'src/components/StatusBar.tsx :: no status-bar context duplicate');
  for (const f of ['src/components/Composer.tsx', 'src/components/ChatPanel.tsx', 'src/components/StatusBar.tsx']) {
    assert.ok(!/ctx-meter|ctx-track|ctx-fill/.test(stripComments(read(f))), `${f} :: straight ctx-meter/ctx-track/ctx-fill strip present`);
  }
  assert.ok(!ALL_TSX.some(({ code }) => /<ContextRing\b/.test(code)), 'no <ContextRing> duplicate anywhere in src/**/*.tsx');
  const m = markersOf('Composer');
  assert.equal(m.ctxLensCompact, 1, `src/components/Composer.tsx :: rendered Composer must contain exactly one compact orb (found ${m.ctxLensCompact})`);
  assert.equal(m.ctxMeter, false, 'src/components/Composer.tsx :: rendered Composer must contain no ctx-meter/ctx-track/ctx-fill');
});

test('WAVE GLOBAL: no rendered screen emits a ctx-meter strip', () => {
  const bad = RESULTS.filter((r) => r.markers && r.markers.ctxMeter).map((r) => r.id);
  assert.deepEqual(bad, [], `ctx-meter strip found in rendered screens: ${bad.join(', ')}`);
});

test('99 · WAVE COUNTS (printed for the diagnosis report)', () => {
  const stream = stripComments(read('src/components/StreamTimeline.tsx'));
  const chat = stripComments(read('src/components/ChatPanel.tsx'));
  const msg = stripComments(read('src/components/MessageView.tsx'));
  const comp = stripComments(read('src/components/Composer.tsx'));
  const thinkM = RESULTS.find((r) => r.id === 'StreamBandShell(think·live)')?.markers ?? {};
  const runM = RESULTS.find((r) => r.id === 'ChatPanel(running·circles)')?.markers ?? {};
  const compM = RESULTS.find((r) => r.id === 'Composer')?.markers ?? {};
  Object.assign(WAVE_COUNTS, {
    stream_logo: count(stream, '<Logo'),
    think_brand: count(stream, 'ThinkBrand'),
    think_spin_ssr: !!thinkM.thinkSpin,
    chat_live_indicator: count(chat, 'ChatLiveIndicator'),
    chat_live_ring_src: count(chat, 'chat-live-ring'),
    chat_live_ring_ssr: runM.chatLiveRing ?? -1,
    primary_glyph_src: count(chat, 'cp-live-glyph'),
    primary_glyph_ssr: runM.primaryGlyph ?? -1,
    live_panel_mounts_all_tsx: ALL_TSX.reduce((n, f) => n + count(f.code, '<LiveThinkingPanel'), 0),
    compact_orbit_mounts_all_tsx: ALL_TSX.reduce((n, f) => n + count(f.code, '<CompactThinkingOrbit'), 0),
    msg_logo: count(msg, '<Logo'),
    chat_logo: count(chat, '<Logo'),
    context_lens_src: count(comp, '<ContextLens'),
    context_orb_ssr: compM.ctxLensCompact ?? -1,
    ctx_meter_screens: RESULTS.filter((r) => r.markers?.ctxMeter).map((r) => r.id),
    logo_sig_think_ssr: !!thinkM.logoSignature,
    logo_sig_running_ssr: !!runM.logoSignature,
    screens: RESULTS.length,
    controls_scanned: RESULTS.reduce((n, r) => n + r.controlsScanned, 0),
    dead_controls: RESULTS.reduce((n, r) => n + r.dead.length, 0),
    unstable_screens: RESULTS.filter((r) => r.unstable.length).length,
  });
  console.log('WAVE_COUNTS=' + JSON.stringify(WAVE_COUNTS));
});

// ------------------------------------------------------------
// D. THIS WAVE — ENGINE: real kdx:agent:run param shapes.
// ------------------------------------------------------------
function record(shape, r, detail, pass = true) {
  ENGINE_RESULTS.push({ shape, pass, detail: detail ?? '' });
  return r;
}
/** Drive one shape, run assertions, and record PASS or FAIL (with diagnostics)
 *  so the final counts are honest even when a shape breaks. */
async function driveAndCheck(shape, raw, check) {
  const r = await driveRun(raw);
  const diag = `events=[${r.events.map((e) => e.type).join(',')}] requests=${r.requests.length}`;
  try {
    const detail = check(r);
    record(shape, r, detail ?? diag, true);
  } catch (e) {
    record(shape, r, `${e && e.message ? e.message : String(e)} :: ${diag}`, false);
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

test('ENGINE SOURCE: vague rejection gone + gated event-forwarding root-cause fix present', () => {
  const src = stripComments(readFileSync(join(ROOT, 'electron/agent/register.ts'), 'utf8'));
  assert.doesNotMatch(src, /Invalid run parameters \(missing messages or model\)/i,
    'electron/agent/register.ts still contains the exact vague rejection string');
  assert.match(src, /normalizeRunParams/, 'repair boundary normalizeRunParams must exist');
  // ROOT CAUSE: gated() must forward the electron event to handlers declared
  // `(_e, ...)` — dropping it shifted every arg by one, so raw was ALWAYS
  // undefined and every run reported the vague error.
  assert.match(src, /\)\(e, \.\.\.args\)/,
    'gated() must call fn(e, ...args) so kdx:agent:run receives raw params');
});

test('ENGINE SHAPE 1/4: full normal params → run starts (provider called)', async () => {
  await driveAndCheck('normal', baseParams({ provider: 'custom', model: 'm-normal', maxTokens: 512 }), (r) => {
    assertCleanRun('normal', r);
    assert.ok(r.events.some((e) => e.type === 'turn_end'), `normal: no terminal turn_end event: ${JSON.stringify(r.events.map((e) => e.type))}`);
    assert.ok(r.requests.some((q) => q.model === 'm-normal'), `normal: provider never called with m-normal: ${JSON.stringify(r.requests)}`);
    return `provider requests=${r.requests.length}, events=${r.events.length}`;
  });
});

test('ENGINE SHAPE 2/4: model as "custom/m-string" string → normalized, run starts', async () => {
  await driveAndCheck('model-as-string', baseParams('custom/m-string'), (r) => {
    assertCleanRun('model-as-string', r);
    assert.ok(r.requests.some((q) => q.model === 'm-string'), `model-as-string: provider never called with m-string: ${JSON.stringify(r.requests)}`);
    return `provider requests=${r.requests.length}, events=${r.events.length}`;
  });
});

test('ENGINE SHAPE 3/4: missing messages + explicit text → synthesized user row, run starts', async () => {
  const p = baseParams({ provider: 'custom', model: 'm-repair' });
  delete p.messages;
  p.text = 'Repaired hello from the text field';
  await driveAndCheck('missing-messages+text', p, (r) => {
    assertCleanRun('missing-messages+text', r);
    assert.ok(r.requests.some((q) => q.model === 'm-repair'), `missing-messages: provider never called: ${JSON.stringify(r.requests)}`);
    assert.ok(r.requests.some((q) => q.messages.some((m) => m.role === 'user' && /Repaired hello/.test(String(m.content)))),
      `missing-messages: synthesized user row not sent: ${JSON.stringify(r.requests)}`);
    return `provider requests=${r.requests.length}, events=${r.events.length}`;
  });
});

test('ENGINE SHAPE 4/4: empty messages, no text → precise refusal, no vague error, no crash', async () => {
  const p = baseParams({ provider: 'custom', model: 'm-empty' });
  p.messages = [];
  p.sessionId = 'v1123-empty-no-session';
  await driveAndCheck('empty-messages', p, (r) => {
    assertCleanRun('empty-messages', r);
    assert.equal(r.requests.length, 0, `empty-messages: a run must NOT start without any user message: ${JSON.stringify(r.requests)}`);
    const reason = r.events.find((e) => e.type === 'error');
    assert.ok(reason && reason.code === 'NO_USER_MESSAGE',
      `empty-messages: expected precise machine code NO_USER_MESSAGE, got: ${JSON.stringify(r.events)}`);
    assert.ok(reason && String(reason.message).length > 20, 'empty-messages: actionable reason text present');
    return `code=${reason?.code}, reason="${String(reason?.message).slice(0, 60)}", events=${r.events.length}`;
  });
});

test('ENGINE SHAPE BONUS: undefined / non-object params → precise refusal, never vague, never crash', async () => {
  for (const [label, raw, expectedCode] of [['undefined', undefined, 'NO_PARAMS'], ['number', 42, 'BAD_SHAPE']]) {
    await driveAndCheck(`raw-${label}`, raw, (r) => {
      assertCleanRun(`raw-${label}`, r);
      assert.equal(r.requests.length, 0, `raw-${label}: no run should start`);
      const reason = r.events.find((e) => e.type === 'error');
      assert.ok(reason && reason.code === expectedCode,
        `raw-${label}: expected precise machine code ${expectedCode}, got: ${JSON.stringify(r.events)}`);
      return `code=${reason?.code}, reason="${String(reason?.message).slice(0, 60)}"`;
    });
  }
});
