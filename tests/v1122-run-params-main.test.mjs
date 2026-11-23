// ============================================================
// v11.22 — HARDENED `kdx:agent:run` BOUNDARY (main process)
//
// Drives the REAL registered IPC handler from electron/agent/register.ts
// (esbuild-bundled, with every service/engine dependency stubbed) using
// malformed / partial params. Asserts that:
//   · repaired params REACH the engine (runAgent capture),
//   · otherwise a PRECISE, actionable, single-language reason is emitted,
//   · the old vague "Invalid run parameters (missing messages or model)"
//     NEVER reaches the user,
//   · nothing throws or crashes.
//
// Run:
//   node --test --test-force-exit tests/v1122-run-params-main.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1122-params-'));

// register.ts only TYPE-imports electron, so the electron stub is never loaded;
// initialize the shared state the stubbed modules write into here.
globalThis.__v1122 = {
  handlers: {}, engineCalls: [], events: [], settings: null, session: null,
};

// ---------- electron stub: capture ipcMain.handle registrations ----------
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `globalThis.__v1122 = globalThis.__v1122 || { handlers: {}, engineCalls: [], events: [], settings: null, session: null };
   module.exports = {
     app: { getPath: () => ${JSON.stringify(userDataDir)}, whenReady: async () => true, on() {}, quit() {} },
     ipcMain: {
       handle: (ch, fn) => { globalThis.__v1122.handlers[ch] = fn; },
       on() {},
     },
     BrowserWindow: { getAllWindows: () => [] },
     Notification: { isSupported: () => false },
     safeStorage: { isEncryptionAvailable: () => false },
     shell: {}, screen: {}, powerMonitor: { on() {} },
   };`,
);

// ---------- stubs for every dependency of register.ts ----------
// Only `runAgent` matters: it CAPTURES the repaired params instead of running
// a model. Everything else is inert so the test stays local + deterministic.
const STUBS = {
  './engine': `
    export const ENGINE_VERSION = 'v1122-test';
    export async function runAgent(params, io) {
      globalThis.__v1122.engineCalls.push(JSON.parse(JSON.stringify(params)));
      try { io.send({ type: 'turn_end' }); } catch {}
    }
    export function applyPlanApproval() {}
    export function buildSessionRecap() { return ''; }
    export function enqueueUserMessage() { return 0; }
    export function getSessionGoal() { return { goal: '' }; }
    export function getSessionTaskMode() { return 'build'; }
    export function steer() { return 0; }
    export function setSessionTaskMode() {}
  `,
  './review': `export async function reviewWorkingDiff() { return { ok: true, findings: [] }; }`,
  './skills': `
    export function listSkills() { return []; }
    export async function deleteSkill() { return true; }
    export async function detectRivalSkills() { return []; }
    export async function importAllSkillsFrom() { return { imported: 0, failed: 0 }; }
    export async function detectRivalMcpServers() { return []; }
  `,
  '../services/wikiService': `
    export async function generateWiki() { return { ok: true, pages: 0 }; }
    export function getWiki() { return { wiki: null, stale: false, generating: false }; }
    export function isAllowedWikiWorkspace() { return true; }
  `,
  './mcp': `export function setAgentEventSink() {}`,
  '../services/storeService': `
    export function getSettings() { return globalThis.__v1122.settings; }
  `,
  '../services/billingService': `
    export function checkGate() { return { allowed: true }; }
  `,
  '../services/notifyService': `
    export function isDoneNotificationsEnabled() { return false; }
    export function notifyAgentDone() {}
    export function notifyApprovalNeeded() {}
  `,
  '../services/sessionService': `
    export async function load() { return globalThis.__v1122.session; }
  `,
  '../services/flowsService': `export function initFlows() {}`,
  '../services/remoteService': `
    export function remoteSetActiveSession() {}
    export function remoteBroadcast() {}
    export function remoteSetDesktopBridge() {}
  `,
  '../services/pluginService': `export function enabledPluginMcpServers() { return []; }`,
};

const stubPlugin = {
  name: 'v1122-stubs',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      return Object.prototype.hasOwnProperty.call(STUBS, args.path)
        ? { path: args.path, namespace: 'v1122-stub' }
        : null;
    });
    build.onLoad({ filter: /.*/, namespace: 'v1122-stub' }, (args) => ({
      contents: STUBS[args.path],
      loader: 'js',
    }));
  },
};

const outfile = join(tmp, 'register.cjs');
// Real build with the stub plugin (CLI cannot register plugins).
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

let register;
try {
  register = require(outfile);
  register.registerAgentIpc(
    { handle() {}, on() {} }, // real handlers are installed below
    () => null,
  );
} catch (err) {
  console.error('[v1122] register bundle failed:', err?.stack ?? err);
  throw err;
}

// ---------- install the real handler with a recording webContents ----------
const handlers = {};
globalThis.__v1122.settings = {
  model: { provider: 'custom', model: 'settings-default-model' },
  providers: { custom: { apiKey: 'test-key' } },
  recentPaths: [],
};
register.registerAgentIpc(
  {
    handle: (ch, fn) => { handlers[ch] = fn; },
    on() {},
  },
  () => ({
    send: (_channel, event) => {
      globalThis.__v1122.events.push({
        type: event.type,
        message: event.message,
        code: event.code,
        summary: event.summary,
        outcome: event.outcome,
        nextSteps: event.nextSteps,
      });
    },
  }),
);
assert.equal(typeof handlers['kdx:agent:run'], 'function', 'kdx:agent:run handler registered');

// Canonical [en, ar] text from src/i18n.ts (A9) — hardcoded here on purpose:
// the test proves the main process emits EXACTLY the shared key text.
const BAD_PARAMS_EN = 'Run not started — the request had no messages or no model selected. Open Settings → AI providers, choose a model, and send your message again.';
const BAD_PARAMS_AR = 'لم يبدأ التشغيل — الطلب بلا رسائل أو دون اختيار نموذج. افتح الإعدادات ← مزودو الذكاء الاصطناعي، اختر نموذجاً، ثم أعد إرسال رسالتك.';
const NO_WORKSPACE_EN = 'No workspace is open. Open a project folder first, then send your message again.';
const NO_WORKSPACE_AR = 'لا توجد مساحة عمل مفتوحة. افتح مجلد مشروع أولاً، ثم أعد إرسال رسالتك.';

const USER = (content) => ({
  id: 'u1', role: 'user', kind: 'text', content, timestamp: 1,
});

async function drive(params) {
  globalThis.__v1122.engineCalls.length = 0;
  globalThis.__v1122.events.length = 0;
  // file: origin passes the UNCHANGED isTrustedAgentSender gate.
  await handlers['kdx:agent:run']({ senderFrame: { url: 'file:///v1122-test/index.html' } }, params);
  return {
    calls: [...globalThis.__v1122.engineCalls],
    events: [...globalThis.__v1122.events],
  };
}

const errorMessages = (r) => r.events.filter((e) => e.type === 'error').map((e) => e.message);
function assertNoVagueError(r) {
  const all = r.events.map((e) => `${e.message ?? ''} ${e.summary ?? ''}`).join(' | ');
  assert.ok(!/Invalid run parameters/i.test(all), `no vague "Invalid run parameters" (got: ${all})`);
  assert.ok(!/missing messages or model/i.test(all), `no vague "missing messages or model" (got: ${all})`);
}
function assertSingleLanguage(r) {
  const all = errorMessages(r).concat(r.events.filter((e) => e.type === 'task_report').map((e) => e.summary)).join(' ');
  assert.ok(!/[\u0600-\u06FF]/.test(all), `reason must be single-language, no mixed EN+AR (got: ${all})`);
}

// ============================================================
test('v1122 missing messages + text → repaired user message reaches the engine', async () => {
  const r = await drive({
    sessionId: 's1', task: 'chat', text: 'hello from the phone bridge',
    model: { provider: 'custom', model: 'm1' },
  });
  assertNoVagueError(r);
  assertSingleLanguage(r);
  assert.equal(r.calls.length, 1, 'repaired params reached runAgent (not rejected)');
  assert.equal(errorMessages(r).length, 0);
  assert.ok(
    r.calls[0].messages.some((m) => m.role === 'user' && m.content === 'hello from the phone bridge'),
    `synthesized honest user message present (got: ${JSON.stringify(r.calls[0].messages)})`,
  );
});

test('v1122 model as "provider/model" string → parsed into {provider, model}', async () => {
  const r = await drive({
    sessionId: 's2', task: 'chat', messages: [USER('hi')], model: 'custom/string-model',
  });
  assertNoVagueError(r);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].model.provider, 'custom');
  assert.equal(r.calls[0].model.model, 'string-model');
});

test('v1122 missing model.model but valid settings default → falls back instead of aborting', async () => {
  const r = await drive({
    sessionId: 's7', task: 'chat', messages: [USER('hi')], model: { provider: 'custom' },
  });
  assertNoVagueError(r);
  assert.equal(r.calls.length, 1, 'default model kept the run alive');
  assert.equal(r.calls[0].model.model, 'settings-default-model');
});

test('v1122 empty messages → last real user message from the session store is used', async () => {
  globalThis.__v1122.session = {
    id: 's3',
    messages: [
      { id: 'sys:1', role: 'assistant', content: 'ignore me', timestamp: 1 },
      { id: 'u9', role: 'user', content: 'persisted user text', timestamp: 2 },
    ],
  };
  try {
    const r = await drive({ sessionId: 's3', task: 'chat', messages: [] });
    assertNoVagueError(r);
    assert.equal(r.calls.length, 1, 'session fallback reached runAgent');
    assert.equal(r.calls[0].model.model, 'settings-default-model');
    assert.ok(
      r.calls[0].messages.some((m) => m.role === 'user' && m.content === 'persisted user text'),
      `last real user message restored (got: ${JSON.stringify(r.calls[0].messages)})`,
    );
  } finally {
    globalThis.__v1122.session = null;
  }
});

test('v1122 undefined params → canonical err.run.badParams (EN) + NO_PARAMS code', async () => {
  const r = await drive(undefined);
  assertNoVagueError(r);
  assertSingleLanguage(r);
  assert.equal(r.calls.length, 0, 'nothing to run');
  assert.equal(errorMessages(r)[0], BAD_PARAMS_EN, 'exact A9 key text, English');
  assert.equal(r.events.find((e) => e.type === 'error').code, 'NO_PARAMS', 'precise machine reason');
  const report = r.events.find((e) => e.type === 'task_report');
  assert.equal(report.outcome, 'error');
  assert.equal(report.summary, BAD_PARAMS_EN, 'task_report summary uses the same key');
  assert.ok(r.events.some((e) => e.type === 'turn_end'), 'turn_end emitted');
  assert.ok(report.nextSteps?.length, 'report carries an actionable next step');
});

test('v1122 empty messages with no session/text → NO_USER_MESSAGE code, badParams text', async () => {
  const r = await drive({
    sessionId: 's5', task: 'chat', messages: [], model: { provider: 'custom', model: 'm' },
  });
  assertNoVagueError(r);
  assertSingleLanguage(r);
  assert.equal(r.calls.length, 0);
  assert.equal(errorMessages(r)[0], BAD_PARAMS_EN);
  assert.equal(r.events.find((e) => e.type === 'error').code, 'NO_USER_MESSAGE');
});

test('v1122 non-object params → BAD_SHAPE code, no crash', async () => {
  const r = await drive('not-an-object');
  assertNoVagueError(r);
  assertSingleLanguage(r);
  assert.equal(r.calls.length, 0);
  assert.equal(errorMessages(r)[0], BAD_PARAMS_EN);
  assert.equal(r.events.find((e) => e.type === 'error').code, 'BAD_SHAPE');
});

test('v1122 Arabic settings → err.run.badParams emitted in ARABIC ONLY (no mixed EN+AR)', async () => {
  const prev = globalThis.__v1122.settings.language;
  globalThis.__v1122.settings.language = 'ar';
  try {
    const r = await drive(undefined);
    assert.equal(errorMessages(r)[0], BAD_PARAMS_AR, 'exact A9 key text, Arabic');
    assert.equal(r.events.find((e) => e.type === 'error').code, 'NO_PARAMS');
    assert.equal(r.events.find((e) => e.type === 'task_report').summary, BAD_PARAMS_AR);
    assert.ok(!/[A-Za-z]/.test(errorMessages(r)[0]), 'no English characters in the AR string');
  } finally {
    globalThis.__v1122.settings.language = prev;
  }
});

test('v1122 err.setup.noWorkspace wired in review-run, EN and AR, monolingual', async () => {
  const prevLang = globalThis.__v1122.settings.language;
  const prevSession = globalThis.__v1122.session;
  const prevPaths = globalThis.__v1122.settings.recentPaths;
  globalThis.__v1122.session = { id: 'r1', workspace: '' };
  globalThis.__v1122.settings.recentPaths = [];
  const event = { senderFrame: { url: 'file:///v1122-test/index.html' } };
  try {
    globalThis.__v1122.settings.language = 'en';
    const en = await handlers['kdx:agent:review-run'](event, 'r1');
    assert.equal(en.ok, false);
    assert.equal(en.error, NO_WORKSPACE_EN, 'exact A9 key text, English');

    globalThis.__v1122.settings.language = 'ar';
    const ar = await handlers['kdx:agent:review-run'](event, 'r1');
    assert.equal(ar.ok, false);
    assert.equal(ar.error, NO_WORKSPACE_AR, 'exact A9 key text, Arabic');
    assert.ok(!/[A-Za-z]/.test(ar.error), 'no English characters in the AR string');
  } finally {
    globalThis.__v1122.settings.language = prevLang;
    globalThis.__v1122.settings.recentPaths = prevPaths;
    globalThis.__v1122.session = prevSession;
  }
});

after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});
