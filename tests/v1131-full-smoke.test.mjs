// ============================================================
// v11.31 — FULL APP SMOKE GUARD (DIAGNOSIS + TEST ONLY — no app source edits).
//
// Reuses the PROVEN v1128-full-smoke harness verbatim in posture:
//   · esbuild bundle + SSR render EVERY screen (60), watch console.error for
//     React #300, static-scan 670+ controls for dead/no-op handlers;
//   · drive the REAL registered `kdx:agent:run` IPC handler through
//     normalizeRunParams with the reported param shapes (local mock provider).
//
// Carries THIS WAVE's (v11.31) eight demands — each with exact file:line on
// failure. The blunt, bilingual verdict lives in docs/FULL-SMOKE-V1131.md:
//   V1  NO REPORT card / TaskReportCard — no transcript report card, ever;
//       the written report is ONE localized toast + the `lastTaskReport` slice.
//   V2  NO TAINT / CLAIM-AUDIT / PROOF rows under a normal assistant answer
//       (taint UI deleted outright; claim-audit + proof gated on real work).
//   V3  ONE working PROOF button — a real clipboard write + honest toast,
//       not a ledger/panel/tally, and ZERO proof UI on a plain turn.
//   V4  Context orb ALWAYS visible — one compact orb beside the mic even on a
//       fresh session (no `if (!hasData) return null`), honest em-dash centre.
//   V5  ONE circle — exactly one spinner SVG in the ChatPanel run strip; the
//       MessageView gutter copy was deleted, not hidden (wave v1124 contract).
//   V6  429 CONTINUATION path — one bounded in-place retry on the SAME provider,
//       no error row, one consolidated rate-limit notice, answer still streams.
//   V7  DNA path — DNA/Playbook post-run learners wired, with their events and
//       store consumers intact. (Real-work gating is deliberately NOT asserted:
//       the v1127 product decision keeps extraction on each completed turn so
//       conversation can teach DNA. Documented openly in the report.)
//   V8  SKILLS / MCP / SLASH paths — the real engine wiring, loadable public
//       APIs and the canonical registries all exist (source + module-load proof).
//
// Brutally honest by design: a crash, a dead control, a clutter row, a missing
// orb, a duplicate circle, a broken 429 continuation, a silent DNA downgrade or
// a dead skill/MCP/slash path is reported with file:line. No green wash.
//
//   node --test --test-force-exit tests/v1131-full-smoke.test.mjs
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

const TMP = join(tmpdir(), 'sadeem-v1131-full-smoke');
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
// Screen inventory — 54 PROVEN baseline screens + 6 carry-over wave screens = 60.
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

  // ---- THIS WAVE (v11.31) ----
  { id: 'MessageView(plain·no-clutter)', group: 'wave', file: 'src/components/MessageView.tsx', exp: 'MessageView', props: { msg: { id: 'a-plain', role: 'assistant', kind: 'text', content: 'مرحباً — a plain answer with no work.', streaming: false, model: 'custom/m', timestamp: now() }, turnStart: true } },
  { id: 'MessageView(reasoning·30px)', group: 'wave', file: 'src/components/MessageView.tsx', exp: 'MessageView', props: { msg: THINKING_MSG, turnStart: true } },
  { id: 'ChatPanel(running·toolcards)', group: 'wave', file: 'src/components/ChatPanel.tsx', exp: 'ChatPanel', seed: { running: true, session: thinkingSession(), sessions: [thinkingSession()], sessionUsage: { inputTokens: 6912, outputTokens: 0, costUsd: 0 }, ctxWindow: 200000, pendingApproval: null } },
  { id: 'Composer(ctx orb)', group: 'wave', file: 'src/components/Composer.tsx', exp: 'Composer', seed: { lastTurnUsage: null, ctxWindow: 0 } },
  { id: 'ProofRibbon(work turn)', group: 'wave', file: 'src/components/ProofRibbon.tsx', exp: 'ProofRibbon', seed: { proofVisible: true, proof: { status: 'proven', gates: PROOF_GATES, updatedAt: 1, mutation: null } } },
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
let PROVIDERS;
let PATHS;
let buildSeq = 0;
const bundleFiles = [];
const RESULTS = [];
const ENGINE_RESULTS = [];
const WAVE_COUNTS = {};
const WEBSITE_MARKERS = { sections: 0, ids: [], new_ids: [], tx_calls: 0, visuals: [] };
const CIRCLE_COUNTS = { stripSvg: -1, gutterHooks: -1, tremorHooks: -1 };
const PATH_COUNTS = { skills: 0, mcp: 0, slash: 0 };
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
  const outfile = join(ROOT, 'tests', `.v1131-full-smoke-screen-${buildSeq++}.cjs`);
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
    ctxLensCompact: (h.match(/ctx-orb--compact/g) || []).length,
    ctxMeter: /ctx-meter|ctx-track|ctx-fill/.test(h),
    proofToggle: (h.match(/pr-proof-toggle/g) || []).length,
    proofPanel: (h.match(/pr-pop"/g) || []).length,
    claimAuditRow: /CLAIM-AUDIT/.test(h),
    reportCard: /TaskReportCard|>REPORT<|Task finished/.test(h),
    proofRow: />PROOF</.test(h),
    taintRow: /TAINT|FLAGGED|ESCALATED|sc-taint|mv-taint/.test(h),
    toolCard: (h.match(/tl2-card/g) || []).length,
    tsgGlyph: (h.match(/class="tsg"/g) || []).length,
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
// PER-PROCESS TOKEN — the engine persists session journals/traces under the
// shared userDataDir. Reusing a sessionId across two smoke runs makes the
// engine RESTORE the old journal (no provider request, healthy-looking events)
// instead of running fresh. Unique sessionIds keep each run isolated.
const RUN_TOKEN = `${process.pid}-${Date.now()}`;
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
    task: 'chat', sessionId: `v1131-drive-${RUN_TOKEN}-${runSeq++}`,
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

  const waveOut = join(ROOT, 'tests', '.v1131-full-smoke-wave.cjs');
  await esbuild.build({
    stdin: {
      contents:
        "export { MessageView } from './src/components/MessageView';" +
        "export { ChatPanel } from './src/components/ChatPanel';" +
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

  // Providers module for the REAL 429 continuation path (V5).
  const provOut = join(ROOT, 'tests', '.v1131-full-smoke-providers.cjs');
  await esbuild.build({
    stdin: {
      contents:
        "export { streamTurn, providerErrorKindOf, resetRateLimitNotices } from './electron/agent/providers';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: provOut,
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
    external: EXTERNALS, plugins: [stubPlugin], logLevel: 'silent',
  });
  bundleFiles.push(provOut);
  PROVIDERS = require(provOut);

  // Skills / MCP / Slash public APIs — prove the v11.31 paths load and expose
  // their real surfaces. Bundled into engineTmp so require('electron') resolves
  // to the same deterministic stub the registered run handler uses.
  const pathsOut = join(engineTmp, 'paths.cjs');
  await esbuild.build({
    stdin: {
      contents:
        "export { skillsIndexLine, selectSkillsForPrompt, renderSkillInjection, matchSkillsForTask } from './electron/agent/skills';" +
        "export { mcpCallTool, mcpListTools, cachedToolsForEngine, createClient } from './electron/agent/mcp';" +
        "export { SLASH_COMMANDS, parseSlashCommand, isSlashMenuQuery } from './src/lib/modes';" +
        "export { dispatchSlashCommand, listSlashCommands } from './electron/services/slashService';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: pathsOut,
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
    external: EXTERNALS, plugins: [stubPlugin], logLevel: 'silent',
  });
  bundleFiles.push(pathsOut);
  PATHS = require(pathsOut);
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
  lines.push('============ v11.31 FULL APP SMOKE — FINAL REPORT ============');
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
  assert.ok(WAVE && typeof WAVE.ChatPanel === 'function', 'v1131 wave bundle exposes the real components');
  assert.equal(typeof PROVIDERS.streamTurn, 'function', 'providers bundle exposes the real streamTurn');
  assert.ok(PATHS && Array.isArray(PATHS.SLASH_COMMANDS), 'paths bundle exposes the canonical slash registry');
  assert.equal(typeof PATHS.skillsIndexLine, 'function', 'paths bundle exposes the skills index API');
  assert.equal(typeof PATHS.mcpCallTool, 'function', 'paths bundle exposes the MCP tool API');
  assert.equal(typeof PATHS.dispatchSlashCommand, 'function', 'paths bundle exposes the slash dispatcher');
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
// B. THIS WAVE (v11.31) — V1..V7, each with exact file:line.
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
  proof: 'src/components/ProofRibbon.tsx',
  lens: 'src/components/ContextLens.tsx',
  composer: 'src/components/Composer.tsx',
  chatPanel: 'src/components/ChatPanel.tsx',
  statusBar: 'src/components/StatusBar.tsx',
  proofCss: 'src/components/proof.css',
  orbCss: 'src/components/context-orb.css',
  css1: 'src/components/chat-final.css',
  css2: 'src/components/stream-motion.css',
  engine: 'electron/agent/engine.ts',
  store: 'src/store.ts',
  providers: 'electron/agent/providers.ts',
  taint: 'electron/agent/taint.ts',
  tools: 'electron/agent/tools.ts',
  skills: 'electron/agent/skills.ts',
  prompts: 'electron/agent/prompts.ts',
  skillGate: 'electron/agent/skillGate.ts',
  mcp: 'electron/agent/mcp.ts',
  modes: 'src/lib/modes.ts',
  slash: 'electron/services/slashService.ts',
};
const RAW = Object.fromEntries(Object.entries(W).map(([k, p]) => [k, read(p)]));
const CODE = Object.fromEntries(Object.entries(W).map(([k]) => [k, stripTsx(RAW[k])]));
const h = (...a) => React.createElement(...a);
const TAINT_MARKUP = [
  'TAINT', 'FLAGGED', 'ESCALATED', 'Dangerous command after untrusted content',
  'Untrusted source:', 'chat.taint', 'sc-taint', 'mv-taint', 'data-notice="taint"',
];
const CLUTTER_RE = /CLAIM-AUDIT|UNPROVEN|sc-taint|mv-taint|FLAGGED|ESCALATED/i;
/** Assert `needle` appears in source near (within `span` chars before) `anchor`. */
function gatedNear(src, file, anchor, guard, span = 6000, rawSrc = null) {
  const i = src.indexOf(anchor);
  assert.ok(i >= 0, `${file}: expected anchor ${anchor}`);
  const win = src.slice(Math.max(0, i - span), i);
  // Report the RAW file line: stripTsx collapses block-comment newlines.
  const raw = rawSrc || src;
  const ri = raw.indexOf(anchor);
  const line = ri >= 0 ? lineOf(raw, ri) : lineOf(src, i);
  assert.ok(win.includes(guard),
    `${file}:${line} :: ${anchor} must be gated by "${guard}" (found none in preceding ${span} chars)`);
}

// ---- V1 · NO REPORT card / TaskReportCard ----
test('V1/8 · NO REPORT card / TaskReportCard — the written report is a toast, not a transcript row', () => {
  waveCheck('V1 Source', () => {
    const msg = CODE.msg;
    // The card component and its dispatch branch must be deleted outright.
    assert.ok(!/\bfunction\s+TaskReportCard\b/.test(msg),
      'src/components/MessageView.tsx :: TaskReportCard component deleted');
    assert.ok(!/<TaskReportCard\b/.test(msg),
      'src/components/MessageView.tsx :: no <TaskReportCard> render site');
    assert.ok(!msg.includes("model === 'task-report'"),
      'src/components/MessageView.tsx :: no task-report dispatch branch');
    // Defence in depth: a stale persisted task-report row is dropped.
    const drop = between(CODE.msg, 'PROOF_ONLY_ROWS', '];');
    assert.ok(drop.includes("'task-report'"),
      `src/components/MessageView.tsx:${firstLine(RAW.msg, "'task-report'")} :: 'task-report' in the renderer drop set`);
    // No REPORT chip / raw JSON report markup survives in the renderer.
    assert.ok(!/>REPORT</.test(CODE.msg) && !/Task finished/.test(CODE.msg),
      'src/components/MessageView.tsx :: no REPORT / "Task finished" card markup');
    // Store keeps the SLICE + ONE localized toast; it must not push a chat row.
    const st = CODE.store;
    assert.ok(st.includes('lastTaskReport'), 'src/store.ts :: lastTaskReport slice kept (programmatic /report)');
    assert.ok(st.includes('rrEmitReportToast'),
      `src/store.ts:${firstLine(RAW.store, 'rrEmitReportToast(')} :: ONE localized report toast emitted`);
    // The helper definition may remain, but it must never be CALLED: at most
    // one occurrence (`function reportCard(`), zero call sites.
    assert.ok(count(st, 'reportCard(') <= 1,
      `src/store.ts :: reportCard() no longer pushes a transcript row (${count(st, 'reportCard(')} occurrence(s))`);
    // There are two `case 'task_report':` switches (evidence collector + the
    // transcript handler). Target the LAST one — the transcript handler.
    const tcAt = st.lastIndexOf("case 'task_report':");
    assert.ok(tcAt >= 0, 'src/store.ts :: transcript task_report handler present');
    const tc = st.slice(tcAt, tcAt + 2200);
    assert.ok(tc.includes('rrCommitInto') && !tc.includes("model: 'task-report'"),
      `src/store.ts:${lineOf(RAW.store, RAW.store.lastIndexOf("case 'task_report':"))} :: task_report publishes slice + toast, never a chat card`);
  });
  waveCheck('V1 SSR', () => {
    seedStore(WAVE.useStore, {
      proofVisible: false,
      session: {
        id: 's-report', title: 'plain', workspace: 'D:\\ws', createdAt: 1, updatedAt: 1,
        messageCount: 2, totalTokens: 0, totalCostUsd: 0,
        messages: [
          { id: 'u', role: 'user', kind: 'text', content: 'سلم', timestamp: now() },
          { id: 'a', role: 'assistant', kind: 'text', content: 'سلم — a plain answer, nothing more.', streaming: false, model: 'custom/m', timestamp: now() },
        ],
      },
    });
    const msgs = WAVE.useStore.getState().session.messages;
    const html = renderToStaticMarkup(h('div', { className: 'chat-stream' },
      ...msgs.map((m) => h(WAVE.MessageView, { key: m.id, msg: m, turnStart: true }))));
    assert.ok(html.includes('a plain answer, nothing more.'), 'plain answer still renders');
    assert.doesNotMatch(html, /\bREPORT\b|Task finished|task-report|"outcome"/i,
      'SSR plain turn :: no REPORT card / TaskReportCard / raw report JSON');
    // A synthetic persisted report row must be dropped by the renderer.
    const stale = renderToStaticMarkup(h(WAVE.MessageView, {
      msg: { id: 'r', role: 'assistant', kind: 'text', content: '{"outcome":"completed"}', model: 'task-report', timestamp: now() },
      turnStart: true,
    }));
    assert.equal(stale, '', 'a persisted task-report row renders NOTHING (defence in depth)');
  });
  waveDone('V1');
});

// ---- V2 · NO TAINT / CLAIM-AUDIT / PROOF rows ----
test('V2/8 · NO taint / claim-audit / proof rows under a normal answer', () => {
  waveCheck('V2 TaintSource', () => {
    const msg = CODE.msg;
    assert.ok(!/\bTaintRow\b/.test(msg), 'src/components/MessageView.tsx :: TaintRow component deleted');
    assert.ok(!/\btaint\b/i.test(msg), 'src/components/MessageView.tsx :: no live taint UI code');
    assert.ok(!msg.includes("model === 'taint'"), 'src/components/MessageView.tsx :: no taint dispatch branch');
    for (const needle of TAINT_MARKUP) {
      assert.ok(!msg.includes(needle), `src/components/MessageView.tsx :: taint markup "${needle}" removed`);
    }
    for (const [f, css] of [['src/components/chat-final.css', RAW.css1], ['src/components/stream-motion.css', RAW.css2]]) {
      assert.ok(!/\btaint\b/i.test(css), `${f} :: no taint styling`);
    }
    // Honesty: security ENFORCEMENT stays; only the UI row was deleted.
    assert.ok(RAW.taint.includes('shouldEscalateForTaint'), 'electron/agent/taint.ts :: detection intact');
    assert.ok(RAW.tools.includes('shouldEscalateForTaint'), 'electron/agent/tools.ts :: dangerous commands still escalated');
  });
  waveCheck('V2 ClutterGates', () => {
    const eng = CODE.engine;
    assert.ok(eng.includes('const realWorkThisRun ='), `electron/agent/engine.ts:${firstLine(eng, 'const realWorkThisRun =')} :: work gate present`);
    gatedNear(eng, 'electron/agent/engine.ts', "type: 'claim_audit'", 'realWorkThisRun', 6000, RAW.engine);
    gatedNear(eng, 'electron/agent/engine.ts', "type: 'proof_package'", 'realWorkThisRun', 6000, RAW.engine);
    // Renderer defence-in-depth: synthetic proof/audit rows are dropped outright,
    // so a stale persisted session cannot resurrect them either.
    assert.ok(CODE.msg.includes('PROOF_ONLY_ROWS'),
      `src/components/MessageView.tsx:${firstLine(CODE.msg, 'PROOF_ONLY_ROWS')} :: synthetic proof/audit rows suppressed by the renderer`);
    const proofOnly = between(CODE.msg, 'const PROOF_ONLY_ROWS', '];');
    assert.ok(proofOnly.includes("'claim-audit'") && proofOnly.includes("'proof'"),
      'src/components/MessageView.tsx :: claim-audit + proof rows are in the dropped set');
    assert.ok(!/\bClaimAuditRow\b|\bProofCard\b/.test(CODE.msg),
      'src/components/MessageView.tsx :: audit/proof row components deleted');
    // The success-path duplicate PROOF chip must be gone. The only surviving
    // notice('proof', …) calls are honest FAILURE notices inside catch blocks.
    const proofNotices = [...eng.matchAll(/notice\(\s*'proof'\s*,\s*`([^`]*)`/g)].map((m) => m[1]);
    for (const text of proofNotices) {
      assert.match(text, /failed|skipped|no proof verdict/i,
        'electron/agent/engine.ts :: a proof notice must be an honest failure notice, not a duplicate success chip');
    }
    assert.ok(proofNotices.length <= 2, 'electron/agent/engine.ts :: at most the two honest failure notices');
    assert.doesNotMatch(eng, /\[proof\]\s*(?:UNPROVEN|PROVEN|FAILED)[^\n]*saved/i,
      'electron/agent/engine.ts :: duplicate "[proof] UNPROVEN — saved …" success chip removed');
  });
  waveCheck('V2 SSR', () => {
    seedStore(WAVE.useStore, {
      session: {
        id: 's-plain', title: 'plain', workspace: 'D:\\ws', createdAt: 1, updatedAt: 1,
        messageCount: 2, totalTokens: 0, totalCostUsd: 0,
        messages: [
          { id: 'u', role: 'user', kind: 'text', content: 'مرحباً', timestamp: now() },
          { id: 'a', role: 'assistant', kind: 'text', content: 'مرحباً — a plain answer with no work.', streaming: false, model: 'custom/m', timestamp: now() },
        ],
      },
      proofVisible: false,
    });
    const html = renderToStaticMarkup(h('div', { className: 'chat-stream' },
      ...WAVE.useStore.getState().session.messages.map((m) => h(WAVE.MessageView, { key: m.id, msg: m, turnStart: true }))));
    assert.ok(html.includes('plain answer with no work'), 'plain answer text still renders');
    for (const needle of TAINT_MARKUP) assert.ok(!html.includes(needle), `SSR plain turn :: no "${needle}" row`);
    assert.doesNotMatch(html, CLUTTER_RE, 'SSR plain turn :: no CLAIM-AUDIT / PROOF / taint clutter');
  });
  waveDone('V2');
});

// ---- V3 · ONE WORKING PROOF button ----
test('V3/8 · ONE working PROOF button — real copy action, no ledger/panel', () => {
  waveCheck('V3 Source', () => {
    const pr = CODE.proof;
    assert.ok(pr.includes('data-testid="proof-toggle"') && pr.includes('className="pr-proof-toggle"'),
      `src/components/ProofRibbon.tsx:${firstLine(pr, 'data-testid="proof-toggle"')} :: small PROOF button present`);
    assert.equal(count(pr, '<button'), 1, 'src/components/ProofRibbon.tsx :: exactly ONE button');
    assert.ok(pr.includes('if (!proofVisible) return null;'), 'src/components/ProofRibbon.tsx :: plain turn renders ZERO proof UI');
    for (const gone of ['pr-pop', 'pr-check', 'pr-tally', 'pr-kind', 'role="dialog"', '{open &&']) {
      assert.ok(!pr.includes(gone), `src/components/ProofRibbon.tsx :: proof ${gone} section removed`);
    }
    // "Working" = a REAL clipboard write + an honest toast via the store.
    assert.ok(pr.includes('handleProofCopy'), 'src/components/ProofRibbon.tsx :: real copy handler present');
    assert.ok(pr.includes('onClick={handleProofCopy}'), `src/components/ProofRibbon.tsx:${firstLine(pr, 'onClick={handleProofCopy}')} :: copy handler is WIRED to the button`);
    assert.ok(pr.includes('clip.writeText('), 'src/components/ProofRibbon.tsx :: real navigator.clipboard.writeText used');
    assert.ok(pr.includes('notify('), 'src/components/ProofRibbon.tsx :: actual result toasted, no fake "copied" state');
  });
  waveCheck('V3 SSR', () => {
    const r = RESULTS.find((x) => x.id === 'ProofRibbon(work turn)');
    assert.ok(r && r.status === 'RENDERS OK', 'ProofRibbon(work turn) did not render');
    assert.equal(r.markers.proofToggle, 1, 'SSR proof :: exactly one small PROOF button');
    assert.equal(r.markers.proofPanel, 0, 'SSR proof :: no popover panel exists');
    seedStore(WAVE.useStore, { proofVisible: false, proof: { status: 'unproven', gates: [], updatedAt: 0, mutation: null } });
    const idle = renderToStaticMarkup(h(WAVE.ProofRibbon));
    assert.ok(!idle.includes('pr-proof-toggle'), 'SSR proof :: plain turn renders ZERO proof UI');
  });
  waveDone('V3');
});

// ---- V4 · Context orb ALWAYS visible ----
test('V4/8 · Context orb always visible — one compact orb, even at zero usage', () => {
  waveCheck('V4 Source', () => {
    assert.doesNotMatch(RAW.lens, /if\s*\(\s*!hasData\s*\)\s*return null/,
      'src/components/ContextLens.tsx :: the fresh-session hide gate is gone');
    assert.ok(CODE.lens.includes('const noData = !hasData'),
      `src/components/ContextLens.tsx:${firstLine(CODE.lens, 'const noData = !hasData')} :: hasData now drives only the honest centre`);
    const micAt = CODE.composer.indexOf('<VoiceInput');
    const orbAt = CODE.composer.indexOf('<ContextLens');
    assert.ok(micAt >= 0 && orbAt > micAt,
      `src/components/Composer.tsx:${firstLine(CODE.composer, '<ContextLens')} :: one orb beside the mic`);
    assert.equal(count(CODE.composer, '<ContextLens'), 1, 'src/components/Composer.tsx :: exactly one context orb');
    assert.ok(!CODE.chatPanel.includes('<ContextLens'), 'src/components/ChatPanel.tsx :: no header duplicate');
    assert.ok(!RAW.statusBar.includes('<ContextRingButton'), 'src/components/StatusBar.tsx :: no status-bar duplicate');
    assert.ok(RAW.orbCss.includes('.ctx-orb--compact'), 'src/components/context-orb.css :: compact orb contract present');
    assert.ok(RAW.orbCss.includes('prefers-reduced-motion: reduce') && RAW.orbCss.includes('html.reduce-motion'),
      'src/components/context-orb.css :: both motion guards intact');
  });
  waveCheck('V4 SSR', () => {
    // Fresh session: no provider usage + unknown window.
    seedStore(WAVE.useStore, { lastTurnUsage: null, ctxWindow: 0 });
    const html = renderToStaticMarkup(h(WAVE.ContextLens, { compact: true }));
    assert.match(html, /^<div class="ctx-orb-anchor ctx-orb-anchor--compact/,
      'src/components/ContextLens.tsx :: the anchored orb is the first painted node (not null)');
    assert.match(html, /<button class="ctx-orb ctx-orb--compact"/, 'the orb button is mounted beside the mic');
    assert.equal((html.match(/class="ctx-orb-arc"/g) || []).length, 1, 'exactly one arc ring');
    assert.equal((html.match(/<svg\b/g) || []).length, 1, 'exactly one orb svg');
    assert.ok(html.includes('>—</span>'), 'centre is the honest em-dash "not measured yet"');
    assert.doesNotMatch(html, />0%<\/span>/, 'no misleading "0%" implies a known window');
    assert.match(html, /window size unknown/, 'tooltip reports the unknown window');
    const arc = /<circle[^>]*class="ctx-orb-arc"[^>]*stroke-dasharray="([\d.eE+-]+)\s+([\d.eE+-]+)"/.exec(html);
    assert.ok(arc && Number(arc[1]) === 0, 'no data paints a zero-length arc — no invented fill');
    const r = RESULTS.find((x) => x.id === 'Composer(ctx orb)');
    assert.ok(r && r.status === 'RENDERS OK', 'Composer(ctx orb) did not render');
    assert.equal(r.markers.ctxLensCompact, 1, 'SSR Composer :: exactly one compact orb');
    assert.equal(r.markers.ctxMeter, false, 'SSR Composer :: no ctx-meter strip');
  });
  waveDone('V4');
});

// ---- V5 · 429 CONTINUATION path ----
// v11.31 contract: a 429 is RECOVERABLE IN PLACE. The SAME provider is retried
// with bounded exponential backoff (≤1s per wait) — the user's provider is
// NEVER switched because of a 429. One quiet consolidated notice; the answer
// continues to stream. (Stream-drop continuation is the separate bounded path.)
const REAL_FETCH = globalThis.fetch;
function sseBody(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n` +
    'data: [DONE]\n\n';
}
test('V5/8 · 429 continuation — bounded in-place retry, no provider switch, no error row', () => {
  waveCheck('V5 Source', () => {
    const pv = CODE.providers;
    assert.ok(pv.includes('RATE_LIMIT_BACKOFF_CAP_MS = 1000'),
      `electron/agent/providers.ts:${firstLine(pv, 'RATE_LIMIT_BACKOFF_CAP_MS')} :: 429 backoff capped at 1s`);
    assert.ok(pv.includes('resetRateLimitNotices'), 'electron/agent/providers.ts :: dedup reset surface exported');
    assert.ok(/kind === 'rate_limited'/.test(pv), 'electron/agent/providers.ts :: 429 classified as rate_limited');
    assert.ok(pv.includes('maxRateLimitRetries') && pv.includes('rateLimitMaxAttempts'),
      'electron/agent/providers.ts :: bounded in-place 429 retry policy present');
    assert.ok(pv.includes('waiting briefly and continuing the same task'),
      `electron/agent/providers.ts:${firstLine(pv, 'waiting briefly and continuing the same task')} :: the SAME task continues after 429`);
    assert.ok(RAW.providers.includes('provider is NEVER switched because of a 429'),
      'electron/agent/providers.ts :: 429 never switches the provider');
    assert.ok(pv.includes('MAX_STREAM_CONTINUATIONS') && pv.includes('continuationDepth'),
      'electron/agent/providers.ts :: bounded stream-drop continuation present');
    assert.ok(pv.includes('(conversation continues)'),
      'electron/agent/providers.ts :: continuation re-sends the SAME task, never re-asks the prompt');
  });
  // Runtime must be async; drive it outside waveCheck and record failures manually.
  const prevAttempts = process.env.SURNIA_RATE_LIMIT_MAX_ATTEMPTS;
  return (async () => {
    try {
      process.env.SURNIA_RATE_LIMIT_MAX_ATTEMPTS = '3'; // bound the in-place retry for a fast, deterministic test
      PROVIDERS.resetRateLimitNotices();
      const calls = [];
      const queue = { hot: [
        { status: 429, text: '{"error":"rate limit"}', headers: { 'retry-after': '30' } },
        { status: 429, text: '{"error":"rate limit"}', headers: { 'retry-after': '30' } },
      ] };
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(init.body);
        const step = (queue[body.model] ?? []).shift() ?? { status: 200, text: 'CONTINUED-ANSWER' };
        calls.push({ model: body.model, status: step.status });
        if (step.status !== 200) return new Response(step.text, { status: step.status, headers: step.headers ?? {} });
        return new Response(sseBody(step.text), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      };
      const notices = []; let text = ''; let stopReason = ''; let threw = null;
      const model = (id) => ({ provider: 'custom', model: id, maxTokens: 64 });
      try {
        const res = await PROVIDERS.streamTurn({
          model: model('hot'), baseUrl: 'http://mock.local/v1', system: 'system',
          messages: [{ role: 'user', text: 'finish the task' }], tools: [],
          signal: new AbortController().signal,
          onNotice: (n) => notices.push(n), onText: (t) => { text += t; },
        });
        stopReason = res.stopReason;
      } catch (e) { threw = e; }
      finally {
        globalThis.fetch = REAL_FETCH;
        if (prevAttempts === undefined) delete process.env.SURNIA_RATE_LIMIT_MAX_ATTEMPTS;
        else process.env.SURNIA_RATE_LIMIT_MAX_ATTEMPTS = prevAttempts;
      }

      assert.equal(threw, null, `electron/agent/providers.ts :: a recoverable 429 must not throw: ${threw}`);
      const hotCalls = calls.filter((c) => c.model === 'hot').length;
      assert.ok(hotCalls >= 2 && hotCalls <= 3,
        `electron/agent/providers.ts :: bounded in-place retry of the SAME provider (got ${hotCalls} calls)`);
      assert.equal(calls.length, hotCalls,
        'electron/agent/providers.ts :: 429 must NEVER switch to another provider');
      const rl = notices.filter((n) => n.kind === 'rate_limited');
      assert.equal(rl.length, 1, `electron/agent/providers.ts :: exactly ONE consolidated rate-limit notice: ${JSON.stringify(notices)}`);
      assert.ok(notices.every((n) => n.kind !== 'error'), 'electron/agent/providers.ts :: a recovered 429 shows NO error row');
      assert.ok(notices.every((n) => !/\bfailover\b/i.test(String(n.text))), 'electron/agent/providers.ts :: no "failover" spam');
      assert.equal(text, 'CONTINUED-ANSWER', 'electron/agent/providers.ts :: the answer continues to stream through');
      assert.equal(stopReason, 'end_turn', 'electron/agent/providers.ts :: the continued stream terminates honestly');
    } catch (e) {
      FAILURES.push(`V5 Runtime :: ${e && e.message ? String(e.message).replace(/\n/g, ' | ') : String(e)}`);
    }
    waveDone('V5');
  })();
});

// ---- V6 · DNA path ----
test('V6/8 · DNA path — post-run learners wired, events + store consumers intact', () => {
  waveCheck('V6 Source', () => {
    const eng = CODE.engine;
    const dnaAt = eng.indexOf('learnDNAFacts(');
    assert.ok(dnaAt >= 0, `electron/agent/engine.ts :: learnDNAFacts call present`);
    const pbAt = eng.indexOf('learnPlaybookFacts(');
    assert.ok(pbAt >= 0, `electron/agent/engine.ts :: learnPlaybookFacts call present`);
    // v11.31 PRODUCT DECISION (founder): DNA must learn from conversation too,
    // not only from file/command work — "الـ DNA لا يعمل" was the complaint.
    // Gating these by realWorkThisRun made every DNA end-to-end suite collapse,
    // so extraction intentionally runs on each completed chat turn. Honesty is
    // preserved by the no-data '—' UI and by requiring a real extract result
    // before any DNA event/toast is emitted.
    assert.ok(dnaAt >= 0 && pbAt >= 0, 'both post-run learners are wired');
    assert.ok(CODE.store.includes("case 'dna_updated'"), 'the dna_note write path refreshes the UI too');
    assert.ok(eng.includes("type: 'dna_updated'"), 'electron/agent/engine.ts :: dna_updated event still emitted for real work');
    assert.ok(eng.includes("type: 'playbook_learned'"), 'electron/agent/engine.ts :: playbook_learned still emitted for real work');
    // Store consumers (state + toast) remain intact — the path still works.
    assert.ok(CODE.store.includes("case 'playbook_learned'"), 'src/store.ts :: playbook_learned toast consumer intact');
    assert.ok(CODE.store.includes("case 'dna_updated'"), 'src/store.ts :: dna_updated consumer intact');
  });
  waveCheck('V6 SSR/Store', () => {
    // A plain turn must not manufacture DNA/learning rows in the transcript.
    seedStore(WAVE.useStore, {
      session: {
        id: 's-dna', title: 'plain', workspace: 'D:\\ws', createdAt: 1, updatedAt: 1,
        messageCount: 1, totalTokens: 0, totalCostUsd: 0,
        messages: [{ id: 'a', role: 'assistant', kind: 'text', content: 'salam — a plain answer.', streaming: false, model: 'custom/m', timestamp: now() }],
      },
      proofVisible: false,
    });
    const html = renderToStaticMarkup(h(WAVE.MessageView, { msg: WAVE.useStore.getState().session.messages[0], turnStart: true }));
    assert.ok(html.includes('salam — a plain answer.'), 'plain answer still renders');
    assert.doesNotMatch(html, /LEARNED|PLAYBOOK|DNA|CLAIM-AUDIT|PROOF/i,
      'src/components/MessageView.tsx :: a plain turn shows no DNA/learning/audit/proof row');
  });
  waveDone('V6');
});

// ---- V7 · ONE circle (the single spinning instrument) ----
// Founder contract (v1124, still binding in v11.31): the one spinning circle
// lives INSIDE ChatPanel's RunStatusLine strip. MessageView's old gutter copy
// was DELETED (component + mount + hooks), not hidden. No wave / nib / beads /
// keyed-word trembling decor survives; reasoning is plain, stable text.
const CIRCLE_HOOKS = [
  'CompactThinkingOrbit', 'sc-think-orbit-svg', 'sc-think-orbit',
  'data-streaming', 'insetInlineStart: -24',
];
const TREMOR_HOOKS = [
  'LiveWave', 'sc-live-wave', 'WAVE_BARS',
  'LiveNib', 'mv-live-nib', 'mv-live-spark', 'NIB_ORBIT_R',
  'PhaseBeads', 'mv-phase-beads', 'mv-bead',
  'revealWords', 'sc-reason-word', 'sc-reason-dots',
  'deltaWordCount', 'waveTick', 'nibTick', 'thinkWords',
];
test('V7/8 · ONE circle — single spinner in ChatPanel, zero gutter circles in MessageView', () => {
  waveCheck('V7 Source', () => {
    const chat = CODE.chatPanel;
    const start = chat.indexOf('function RunStatusLine');
    assert.ok(start >= 0,
      `src/components/ChatPanel.tsx:${firstLine(RAW.chatPanel, 'function RunStatusLine')} :: RunStatusLine exists`);
    const nextFn = chat.indexOf('\nfunction ', start + 1);
    const strip = chat.slice(start, nextFn > 0 ? nextFn : undefined);
    assert.equal(count(strip, '<svg'), 1,
      `src/components/ChatPanel.tsx:${firstLine(RAW.chatPanel, '<svg')} :: exactly ONE SVG in the run strip`);
    assert.ok(/animateTransform|<animate\s/.test(strip),
      'src/components/ChatPanel.tsx :: that one SVG is the spinner');
    assert.ok(strip.includes('formatElapsedClock'),
      'src/components/ChatPanel.tsx :: real elapsed clock in the strip');
    const msg = CODE.msg;
    for (const hook of CIRCLE_HOOKS) {
      assert.equal(count(msg, hook), 0,
        `src/components/MessageView.tsx :: no gutter-circle hook "${hook}"`);
    }
    for (const hook of TREMOR_HOOKS) {
      assert.equal(count(msg, hook), 0,
        `src/components/MessageView.tsx :: no trembling-decor hook "${hook}"`);
    }
    assert.ok(msg.includes('function PrecisionThinkingOrbit'),
      `src/components/MessageView.tsx:${firstLine(RAW.msg, 'function PrecisionThinkingOrbit')} :: the one reasoning-head instrument kept`);
    CIRCLE_COUNTS.stripSvg = 1;
    CIRCLE_COUNTS.gutterHooks = CIRCLE_HOOKS.reduce((n, hk) => n + count(msg, hk), 0);
    CIRCLE_COUNTS.tremorHooks = TREMOR_HOOKS.reduce((n, hk) => n + count(msg, hk), 0);
  });
  waveCheck('V7 SSR', () => {
    for (const streaming of [true, false]) {
      const html = renderToStaticMarkup(h(WAVE.MessageView, {
        msg: {
          id: 'a-circle', role: 'assistant', kind: 'text',
          thinking: 'Let me work through the reasoning carefully.',
          content: 'The result is ready.', streaming,
          model: 'custom/m', thinkMs: 1200, timestamp: now(),
        },
        turnStart: true,
      }));
      for (const hook of CIRCLE_HOOKS.concat(TREMOR_HOOKS)) {
        assert.ok(!html.includes(hook), `SSR streaming=${streaming} :: rendered row has no "${hook}"`);
      }
      assert.ok(html.includes('sc-reason-orbit-svg'),
        `SSR streaming=${streaming} :: the one reasoning-head instrument remains`);
      assert.ok(html.includes('The result is ready.'), `SSR streaming=${streaming} :: answer text still renders`);
    }
  });
  waveDone('V7');
});

// ---- V8 · SKILLS / MCP / SLASH paths (source wiring + loadable public APIs) ----
// The v11.31 feature agents shipped skills, MCP and slash work. This guard does
// not re-run their deep suites; it proves the PATHS are wired into the real
// engine/renderer and that their public APIs load, with exact file:line on any
// break. (Deep behaviour lives in tests/v1131-*.test.mjs.)
test('V8/8 · Skills / MCP / Slash paths — real wiring + loadable public APIs', () => {
  waveCheck('V8 Skills', () => {
    const eng = CODE.engine;
    assert.ok(eng.includes('skillsIndexLine') && eng.includes("from './skills'"),
      `electron/agent/engine.ts:${firstLine(RAW.engine, 'skillsIndexLine')} :: engine wires the skills index`);
    assert.ok(eng.includes('skillsIndexLine(workspace'),
      `electron/agent/engine.ts:${firstLine(RAW.engine, 'skillsIndexLine(workspace')} :: skills index reaches the system prompt`);
    assert.ok(eng.includes("p.call.name === 'use_skill'"),
      `electron/agent/engine.ts:${firstLine(RAW.engine, "p.call.name === 'use_skill'")} :: use_skill handled by the real engine`);
    const sk = CODE.skills;
    for (const api of [
      'export async function skillsIndexLine',
      'export async function matchSkillsForTask',
      'export function selectSkillsForPrompt',
      'export function renderSkillInjection',
    ]) {
      assert.ok(sk.includes(api), `electron/agent/skills.ts:${firstLine(RAW.skills, api)} :: ${api} present`);
    }
    assert.ok(RAW.prompts.includes('SKILLS-FIRST RULE') && RAW.prompts.includes('use_skill BEFORE'),
      `electron/agent/prompts.ts:${firstLine(RAW.prompts, 'SKILLS-FIRST RULE')} :: SKILLS-FIRST rule in the prompt`);
    assert.ok(RAW.skillGate.includes('promoteSkillsFromTraces') && RAW.skillGate.includes('skillGateStatus'),
      'electron/agent/skillGate.ts :: evidence gate present');
    PATH_COUNTS.skills = 1;
  });
  waveCheck('V8 MCP', () => {
    const eng = CODE.engine;
    assert.ok(eng.includes("from './mcp'") && eng.includes('mcpListTools'),
      `electron/agent/engine.ts:${firstLine(RAW.engine, "from './mcp'")} :: engine wires the MCP bridge`);
    assert.ok(eng.includes('mcpListTools(server)'),
      `electron/agent/engine.ts:${firstLine(RAW.engine, 'mcpListTools(server)')} :: MCP tools enumerated for the engine`);
    for (const api of ['createClient', 'mcpListTools', 'mcpCallTool', 'cachedToolsForEngine', 'closeAllMcpClients']) {
      assert.ok(RAW.mcp.includes('function ' + api),
        `electron/agent/mcp.ts:${firstLine(RAW.mcp, 'function ' + api)} :: ${api} export present`);
    }
    assert.ok(SCREENS.some((s) => s.exp === 'MCPPanel'),
      'src/components/panels/MCPPanel.tsx :: MCP panel is in the 60-screen SSR set');
    PATH_COUNTS.mcp = 1;
  });
  waveCheck('V8 Slash', () => {
    const modes = RAW.modes;
    assert.ok(modes.includes('export const SLASH_COMMANDS'),
      `src/lib/modes.ts:${firstLine(modes, 'export const SLASH_COMMANDS')} :: canonical slash registry present`);
    assert.ok(modes.includes('export function parseSlashCommand') && modes.includes('export function isSlashMenuQuery'),
      'src/lib/modes.ts :: slash parsing + menu-query helpers present');
    assert.ok(count(modes, '{ cmd:') >= 8,
      `src/lib/modes.ts:${firstLine(modes, '{ cmd:')} :: 8+ advertised slash commands`);
    assert.ok(RAW.composer.includes('isSlashMenuQuery'),
      `src/components/Composer.tsx:${firstLine(RAW.composer, 'isSlashMenuQuery')} :: Composer wires the slash menu`);
    assert.ok(RAW.store.includes('slash.'),
      'src/store.ts :: real slash handlers/toasts present');
    assert.ok(RAW.slash.includes('export async function dispatchSlashCommand'),
      `electron/services/slashService.ts:${firstLine(RAW.slash, 'export async function dispatchSlashCommand')} :: slash dispatcher present`);
    PATH_COUNTS.slash = PATHS.SLASH_COMMANDS.length;
  });
  waveCheck('V8 Runtime', () => {
    assert.ok(PATHS && Array.isArray(PATHS.SLASH_COMMANDS) && PATHS.SLASH_COMMANDS.length >= 8,
      'paths runtime :: canonical slash registry loads with 8+ commands');
    assert.deepEqual(PATHS.parseSlashCommand('/status now'), { name: 'status', args: 'now' },
      'paths runtime :: parseSlashCommand parses command + args');
    assert.equal(PATHS.parseSlashCommand('plain text'), null,
      'paths runtime :: non-slash input is not a command');
    assert.equal(PATHS.isSlashMenuQuery('/pl'), true, 'paths runtime :: slash menu query recognized');
    assert.equal(typeof PATHS.skillsIndexLine, 'function', 'paths runtime :: skills index API loads');
    assert.equal(typeof PATHS.mcpCallTool, 'function', 'paths runtime :: MCP tool API loads');
    assert.equal(typeof PATHS.dispatchSlashCommand, 'function', 'paths runtime :: slash dispatcher loads');
  });
  waveDone('V8');
});

test('99 · WAVE COUNTS (printed for the diagnosis report)', () => {
  const compM = RESULTS.find((r) => r.id === 'Composer(ctx orb)')?.markers ?? {};
  const proofM = RESULTS.find((r) => r.id === 'ProofRibbon(work turn)')?.markers ?? {};
  const plainM = RESULTS.find((r) => r.id === 'MessageView(plain·no-clutter)')?.markers ?? {};
  Object.assign(WAVE_COUNTS, {
    screens: RESULTS.length,
    screens_ok: RESULTS.filter((r) => r.status === 'RENDERS OK').length,
    controls_scanned: RESULTS.reduce((n, r) => n + r.controlsScanned, 0),
    dead_controls: RESULTS.reduce((n, r) => n + r.dead.length, 0),
    unstable_screens: RESULTS.filter((r) => r.unstable.length).length,
    taint_rows_ssr: RESULTS.filter((r) => r.markers?.taintRow).length + (plainM.taintRow ? 1 : 0),
    claim_audit_rows_ssr: plainM.claimAuditRow ? 1 : 0,
    report_rows_ssr: RESULTS.filter((r) => r.markers?.reportCard).length + (plainM.reportCard ? 1 : 0),
    proof_rows_ssr: plainM.proofRow ? 1 : 0,
    proof_toggle_ssr: proofM.proofToggle ?? -1,
    proof_panel_ssr: proofM.proofPanel ?? -1,
    context_orb_ssr: compM.ctxLensCompact ?? -1,
    ctx_meter_ssr: compM.ctxMeter ?? false,
    circle_strip_svg: CIRCLE_COUNTS.stripSvg,
    circle_gutter_hooks: CIRCLE_COUNTS.gutterHooks,
    circle_tremor_hooks: CIRCLE_COUNTS.tremorHooks,
    paths_skills: PATH_COUNTS.skills,
    paths_mcp: PATH_COUNTS.mcp,
    paths_slash_commands: PATH_COUNTS.slash,
    engine_shapes: ENGINE_RESULTS.length,
    engine_pass: ENGINE_RESULTS.filter((e) => e.pass).length,
    wave_failures: FAILURES.length,
  });
  // eslint-disable-next-line no-console
  console.log('V1131_FULL_SMOKE_COUNTS=' + JSON.stringify(WAVE_COUNTS));
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
    const src = stripTsx(readFileSync(join(ROOT, 'electron/agent/register.ts'), 'utf8'));
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
  p.sessionId = `v1131-empty-${RUN_TOKEN}`;
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
  console.log(`V1131_FINAL_FAILURES=${lines.length}${lines.length ? '\n  ' + lines.join('\n  ') : ''}`);
  assert.equal(lines.length, 0, `${lines.length} total smoke failure(s):\n` + lines.join('\n'));
});
