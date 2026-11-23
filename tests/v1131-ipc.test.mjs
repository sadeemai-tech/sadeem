// ============================================================
// v11.31 — IPC BRIDGE + SHARED TYPES (capability audit)
//
// Drives the REAL registered handlers from electron/agent/register.ts
// (esbuild-bundled, every service/engine dependency stubbed) with malformed
// params, hostile senders and cross-cutting events. Asserts that:
//   · sender validation (isTrustedAgentSender) gates EVERY channel,
//   · normalizeRunParams repairs loose/partial payloads and only emits a
//     precise, monolingual machine-coded reason when nothing can be repaired,
//   · permission/task modes are CLAMPED and caller-supplied credentials are
//     stripped (no raw JSON / credential override at the IPC boundary),
//   · approval decisions with an unknown action are ignored,
//   · every event type — including sys_notice (the engine's onNotice channel)
//     — is forwarded, and pending text flushes BEFORE a structural event,
//   · the typed renderer surface (src/lib/api.ts) covers the preload bridge.
//
// Run: node --test --test-force-exit tests/v1131-ipc.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1131-ipc-'));

globalThis.__v1131 = {
  handlers: {},
  engineCalls: [],
  events: [],
  settings: null,
  session: null,
  requestDecision: false,
  holdRun: false,
  releaseRun: null,
  decisionResolutions: [],
  emitNotice: false,
};

// ---------- electron stub (register.ts only TYPE-imports electron) ----------
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  [
    'globalThis.__v1131 = globalThis.__v1131 || {};',
    'module.exports = {',
    '  app: { getPath: () => ' + JSON.stringify(userDataDir) + ', whenReady: async () => true, on() {}, quit() {} },',
    '  ipcMain: { handle: (ch, fn) => { globalThis.__v1131.handlers[ch] = fn; }, on() {} },',
    '  BrowserWindow: { getAllWindows: () => [] },',
    '  Notification: { isSupported: () => false },',
    '  safeStorage: { isEncryptionAvailable: () => false },',
    '  shell: {}, screen: {}, powerMonitor: { on() {} },',
    '};',
  ].join('\n'),
);

// ---------- inert stubs for every dependency of register.ts ----------
const STUBS = {
  './engine': [
    "export const ENGINE_VERSION = 'v1131-test';",
    'export async function runAgent(params, io) {',
    '  const G = globalThis.__v1131;',
    '  G.engineCalls.push(JSON.parse(JSON.stringify(params)));',
    '  if (G.requestDecision) {',
    "    io.getDecision('req-1').then((d) => { G.decisionResolutions.push(d); });",
    '  }',
    '  if (G.emitNotice) io.send({ type: "text_delta", text: "streamed" });',
    '  if (G.emitNotice) io.send({ type: "sys_notice", kind: "routeStream", text: "stream_recovered" });',
    '  if (G.holdRun) await new Promise((res) => { G.releaseRun = res; });',
    "  io.send({ type: 'turn_end' });",
    '}',
    'export function applyPlanApproval() {}',
    "export function buildSessionRecap() { return ''; }",
    'export function enqueueUserMessage() { return 0; }',
    "export function getSessionGoal() { return { goal: '' }; }",
    "export function getSessionTaskMode() { return 'build'; }",
    'export function steer() { return 0; }',
    'export function setSessionTaskMode() {}',
  ].join('\n'),
  './review': 'export async function reviewWorkingDiff() { return { ok: true, findings: [] }; }',
  './skills': [
    'export function listSkills() { return []; }',
    'export async function deleteSkill() { return true; }',
    'export async function detectRivalSkills() { return []; }',
    'export async function importAllSkillsFrom() { return { imported: 0, failed: 0 }; }',
    'export async function detectRivalMcpServers() { return []; }',
  ].join('\n'),
  '../services/wikiService': [
    'export async function generateWiki() { return { ok: true, pages: 0 }; }',
    'export function getWiki() { return { wiki: null, stale: false, generating: false }; }',
    'export function isAllowedWikiWorkspace() { return true; }',
  ].join('\n'),
  './mcp': 'export function setAgentEventSink() {}',
  '../services/storeService': 'export function getSettings() { return globalThis.__v1131.settings; }',
  '../services/billingService': 'export function checkGate() { return { allowed: true }; }',
  '../services/notifyService': [
    'export function isDoneNotificationsEnabled() { return false; }',
    'export function notifyAgentDone() {}',
    'export function notifyApprovalNeeded() {}',
  ].join('\n'),
  '../services/sessionService': 'export async function load() { return globalThis.__v1131.session; }',
  '../services/flowsService': 'export function initFlows() {}',
  '../services/remoteService': [
    'export function remoteSetActiveSession() {}',
    'export function remoteBroadcast() {}',
    'export function remoteSetDesktopBridge() {}',
  ].join('\n'),
  '../services/pluginService': 'export function enabledPluginMcpServers() { return []; }',
};

const stubPlugin = {
  name: 'v1131-stubs',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) =>
      Object.prototype.hasOwnProperty.call(STUBS, args.path)
        ? { path: args.path, namespace: 'v1131-stub' }
        : null,
    );
    build.onLoad({ filter: /.*/, namespace: 'v1131-stub' }, (args) => ({
      contents: STUBS[args.path],
      loader: 'js',
    }));
  },
};

const outfile = join(tmp, 'register.cjs');
await esbuild.build({
  entryPoints: [join(ROOT, 'electron/agent/register.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  plugins: [stubPlugin],
  logLevel: 'silent',
});

const register = require(outfile);
globalThis.__v1131.settings = {
  language: 'en',
  model: { provider: 'custom', model: 'settings-default-model' },
  providers: { custom: { apiKey: 'test-key' } },
  recentPaths: [],
};
register.registerAgentIpc(
  { handle: (ch, fn) => { globalThis.__v1131.handlers[ch] = fn; }, on() {} },
  () => ({
    send: (_channel, event) => {
      globalThis.__v1131.events.push({
        type: event.type,
        text: event.text,
        kind: event.kind,
        message: event.message,
        code: event.code,
        summary: event.summary,
        outcome: event.outcome,
      });
    },
  }),
);
const H = globalThis.__v1131.handlers;
const TRUSTED = { senderFrame: { url: 'file:///v1131/index.html' } };
const USER = (content) => ({ id: 'u1', role: 'user', kind: 'text', content, timestamp: 1 });

function reset() {
  const G = globalThis.__v1131;
  G.engineCalls.length = 0;
  G.events.length = 0;
  G.decisionResolutions.length = 0;
  G.session = null;
  G.requestDecision = false;
  G.holdRun = false;
  G.releaseRun = null;
  G.emitNotice = false;
}

async function drive(params, event = TRUSTED, opts = {}) {
  const savedSession = globalThis.__v1131.session;
  reset();
  if (opts.keepSession) globalThis.__v1131.session = savedSession;
  await H['kdx:agent:run'](event, params);
  return {
    calls: [...globalThis.__v1131.engineCalls],
    events: [...globalThis.__v1131.events],
  };
}

const errors = (r) => r.events.filter((e) => e.type === 'error');
const codes = (r) => errors(r).map((e) => e.code);

// ============================================================
// 1 — sender validation gates EVERY agent channel
// ============================================================
test('v1131 untrusted sender is rejected on every gated channel (no side effects)', async () => {
  const evil = { senderFrame: { url: 'https://evil.example/index.html' } };
  const cases = [
    ['kdx:agent:run', [{ sessionId: 's', messages: [USER('hi')] }]],
    ['kdx:agent:abort', []],
    ['kdx:agent:approval', [{ requestId: 'req-1', action: 'allow' }]],
    ['kdx:agent:steer', ['s', 'hello']],
    ['kdx:agent:queue-send', ['s', 'hello']],
    ['kdx:agent:task-mode', ['s', 'build']],
    ['kdx:wiki:get', ['w']],
    ['kdx:agent:skills-list', ['w']],
  ];
  reset();
  for (const [channel, args] of cases) {
    let thrown = null;
    try {
      await H[channel](evil, ...args);
    } catch (err) {
      thrown = err;
    }
    assert.ok(
      thrown instanceof Error && thrown.message === 'UNTRUSTED_SENDER',
      `${channel} must reject a hostile frame (got: ${String(thrown?.message ?? thrown)})`,
    );
  }
  assert.equal(globalThis.__v1131.engineCalls.length, 0, 'no run started');
  assert.equal(globalThis.__v1131.events.length, 0, 'no events leaked');
});

test('v1131 legitimate senders (file:, surnia://bundle/, loopback) pass the gate', async () => {
  for (const url of [
    'file:///app/index.html',
    'surnia://bundle/index.html',
    'http://localhost:5173/index.html',
    'http://127.0.0.1:3000/',
  ]) {
    const r = await drive(
      { sessionId: 's', messages: [USER('hi')], model: { provider: 'custom', model: 'm' } },
      { senderFrame: { url } },
    );
    assert.equal(r.calls.length, 1, `${url} is a trusted origin`);
  }
});

// ============================================================
// 2 — normalizeRunParams: repair, never vague, never throw
// ============================================================
test('v1131 missing messages + text → synthesized user message reaches the engine', async () => {
  const r = await drive({ sessionId: 's', text: 'from phone', model: { provider: 'custom', model: 'm' } });
  assert.equal(r.calls.length, 1);
  assert.equal(errors(r).length, 0);
  assert.ok(r.calls[0].messages.some((m) => m.role === 'user' && m.content === 'from phone'));
});

test('v1131 model as "provider/model" string → parsed', async () => {
  const r = await drive({ sessionId: 's', messages: [USER('hi')], model: 'custom/string-model' });
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].model.provider, 'custom');
  assert.equal(r.calls[0].model.model, 'string-model');
});

test('v1131 empty messages + no session/text → NO_USER_MESSAGE (precise code)', async () => {
  const r = await drive({ sessionId: 's', messages: [], model: { provider: 'custom', model: 'm' } });
  assert.equal(r.calls.length, 0);
  assert.deepEqual(codes(r), ['NO_USER_MESSAGE']);
  assert.match(errors(r)[0].message, /Run not started/);
  assert.ok(r.events.some((e) => e.type === 'task_report' && e.outcome === 'error'));
  assert.ok(r.events.some((e) => e.type === 'turn_end'));
});

test('v1131 undefined / non-object → NO_PARAMS / BAD_SHAPE, never vague', async () => {
  const u = await drive(undefined);
  assert.deepEqual(codes(u), ['NO_PARAMS']);
  const s = await drive('not-an-object');
  assert.deepEqual(codes(s), ['BAD_SHAPE']);
  const all = [...u.events, ...s.events].map((e) => `${e.message ?? ''} ${e.summary ?? ''}`).join(' ');
  assert.doesNotMatch(all, /Invalid run parameters|missing messages or model/i);
  assert.doesNotMatch(errors(u)[0].message, /[\u0600-\u06FF]/, 'English only');
});

test('v1131 empty messages → last real user message from session is used', async () => {
  globalThis.__v1131.session = {
    id: 's3',
    messages: [
      { id: 'sys:1', role: 'assistant', content: 'ignore me', timestamp: 1 },
      { id: 'u9', role: 'user', content: 'persisted user text', timestamp: 2 },
    ],
  };
  try {
    const r = await drive({ sessionId: 's3', messages: [] }, TRUSTED, { keepSession: true });
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].model.model, 'settings-default-model');
    assert.ok(r.calls[0].messages.some((m) => m.content === 'persisted user text'));
  } finally {
    globalThis.__v1131.session = null;
  }
});

// ============================================================
// 3 — NEW: mode/taskMode clamped, caller credentials stripped
// ============================================================
test('v1131 bogus mode/taskMode are clamped; caller apiKey/baseUrl are stripped', async () => {
  const r = await drive({
    sessionId: 's',
    messages: [USER('hi')],
    model: { provider: 'custom', model: 'm' },
    mode: 'totally-invalid-posture',
    taskMode: 'destroy-everything',
    apiKey: 'ATTACKER-KEY',
    baseUrl: 'https://attacker.example/v1',
  });
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].mode, 'default', 'unknown mode clamped to default');
  assert.equal(r.calls[0].taskMode, undefined, 'unknown taskMode omitted');
  assert.equal(r.calls[0].apiKey, undefined, 'caller API key stripped');
  assert.equal(r.calls[0].baseUrl, undefined, 'caller base URL stripped');
  // The main-process-injected settings credential is still present.
  assert.equal(r.calls[0].providers.custom.apiKey, 'test-key');
});

test('v1131 valid mode/taskMode are preserved', async () => {
  const r = await drive({
    sessionId: 's',
    messages: [USER('hi')],
    model: { provider: 'custom', model: 'm' },
    mode: 'fullAccess',
    taskMode: 'review',
  });
  assert.equal(r.calls[0].mode, 'fullAccess');
  assert.equal(r.calls[0].taskMode, 'review');
});

// ============================================================
// 4 — approval action validation
// ============================================================
test('v1131 approval with unknown action is ignored; valid action resolves', async () => {
  reset();
  globalThis.__v1131.requestDecision = true;
  globalThis.__v1131.holdRun = true;
  await H['kdx:agent:run'](TRUSTED, {
    sessionId: 's', messages: [USER('hi')], model: { provider: 'custom', model: 'm' },
  });
  // runAgent registered the decision synchronously before its held await.
  await H['kdx:agent:approval'](TRUSTED, { requestId: 'req-1', action: 'NOT_A_REAL_ACTION' });
  assert.equal(globalThis.__v1131.decisionResolutions.length, 0, 'garbage action must not resolve');
  await H['kdx:agent:approval'](TRUSTED, { requestId: 'req-1', action: 'allow' });
  assert.deepEqual(globalThis.__v1131.decisionResolutions, [{ requestId: 'req-1', action: 'allow' }]);
  // Release the held run so no timer/task leaks past the test.
  globalThis.__v1131.releaseRun?.();
});

// ============================================================
// 5 — event forwarding (sys_notice = engine onNotice channel)
// ============================================================
test('v1131 every forwarded event type survives, text flushes before a structural event', async () => {
  reset();
  globalThis.__v1131.emitNotice = true;
  await H['kdx:agent:run'](TRUSTED, {
    sessionId: 's', messages: [USER('hi')], model: { provider: 'custom', model: 'm' },
  });
  const types = globalThis.__v1131.events.map((e) => e.type);
  const textIdx = types.indexOf('text_delta');
  const noticeIdx = types.indexOf('sys_notice');
  assert.ok(textIdx >= 0, 'text_delta forwarded');
  assert.ok(noticeIdx >= 0, 'sys_notice (onNotice channel) forwarded');
  assert.ok(textIdx < noticeIdx, 'pending text lands BEFORE the notice card');
  assert.equal(
    globalThis.__v1131.events.find((e) => e.type === 'sys_notice').kind,
    'routeStream',
    'notice kind preserved',
  );
  assert.ok(types.includes('turn_end'), 'terminal event still forwarded');
});

// ============================================================
// 6 — typed surface / invariants (source-level)
// ============================================================
test('v1131 typed renderer surface covers the preload bridge', () => {
  const apiSrc = read('src/lib/api.ts');
  assert.match(
    apiSrc,
    /mcpPromptGet\(id: string, name: string, args\?: Record<string, string>\): Promise<\{ ok: boolean; text\?: string; error\?: string \}>;/,
    'mcpPromptGet is typed (was preload-only)',
  );
  assert.match(apiSrc, /queueSend\(sessionId: string, text: string\): Promise<number>;/, 'queueSend return type is honest');
});

test('v1131 shared validation sets exist and safe defaults are preserved', () => {
  const shared = read('shared/types.ts');
  assert.match(shared, /export const PERMISSION_MODES/, 'permission modes shared');
  assert.match(shared, /export const TASK_MODES/, 'task modes shared');
  assert.match(shared, /export const PERMISSION_DECISION_ACTIONS/, 'decision actions shared');
  assert.match(shared, /ALLOW_MODEL_FAILOVER_DEFAULT = false as const/, 'failover stays opt-in');
});

test('v1131 sender gate kept; no raw JSON.stringify thrown to the renderer', () => {
  const reg = read('electron/agent/register.ts');
  assert.match(reg, /function isTrustedAgentSender\(/, 'isTrustedAgentSender kept');
  assert.doesNotMatch(reg, /JSON\.stringify\(err\)/, 'no raw error JSON on the IPC boundary');
  assert.match(reg, /apiKey: undefined/, 'caller API key neutralised');
  assert.match(reg, /baseUrl: undefined/, 'caller base URL neutralised');
});

after(() => {
  try {
    globalThis.__v1131.releaseRun?.();
  } catch { /* ignore */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});
