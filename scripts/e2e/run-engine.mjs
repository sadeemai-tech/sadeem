// E2E harness (Task e2e-harness-A) — REUSABLE REAL-ENGINE RUNNER.
// ------------------------------------------------------------
// Bundles electron/agent/engine.ts with esbuild at call time, stubs `electron`
// (app.getPath -> tmpdir userData), starts the scripted fake provider, writes
// settings.json (providers.custom.baseUrl -> the provider) and drives the REAL
// runAgent() with a recording AgentIO (auto-allow decisions, never aborted).
//
// Same proven posture as tests/v1111-antifreeze.test.mjs — reused verbatim
// instead of reinvented. Exports runScenario() which returns the derived run
// artifacts: { events, finalText, taskReport, filesWritten, toolsUsed, ... }.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createFakeProvider } from './fake-provider.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)); // sadeem repo root
const require = createRequire(import.meta.url);

let harnessPromise = null;

function bundle(entry, out) {
  execFileSync(
    './node_modules/.bin/esbuild',
    [
      entry,
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${out}`,
      '--external:electron',
      '--external:@xterm/xterm',
      '--external:@xterm/addon-fit',
      '--external:monaco-editor',
      '--external:@monaco-editor/react',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

/**
 * One-time harness setup per process: electron stub on the bundle's resolution
 * path + esbuild-bundled REAL engine. Cached — the bundle is expensive.
 */
export function loadHarness() {
  if (!harnessPromise) {
    harnessPromise = (async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'sadeem-e2e-harness-'));
      const userDataDir = join(tmp, 'userdata');
      mkdirSync(userDataDir, { recursive: true });
      // electron stub: engine.cjs sits in tmp/, so require('electron')
      // resolves tmp/node_modules/electron — a plain-Node fake app.
      const stubDir = join(tmp, 'node_modules', 'electron');
      mkdirSync(stubDir, { recursive: true });
      writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
      writeFileSync(
        join(stubDir, 'index.js'),
        `module.exports = {
  app: { getPath: (k) => ${JSON.stringify(userDataDir)}, whenReady: async () => true, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {} },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: { isSupported: () => false },
  shell: {},
  screen: {},
};
module.exports.default = module.exports;`,
      );
      const enginePath = join(tmp, 'engine.cjs');
      bundle('electron/agent/engine.ts', enginePath);
      const engine = require(enginePath);
      return { tmp, userDataDir, engine, enginePath };
    })();
  }
  return harnessPromise;
}

/** settings.json — providers routed to the fake provider; learning/gates OFF
 *  (they would fire extra post-run model calls and desync the scripted steps). */
function writeSettings(userDataDir, mockBase) {
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 4,
      providers: {
        custom: { apiKey: 'test-key', baseUrl: mockBase },
        zai: { apiKey: 'failover-key', baseUrl: mockBase },
      },
      agent: {
        maxRetries: 0,
        autoCompact: false,
        autoVerify: false,
        autoMemory: false,
        criticGate: false,
      },
      dnaEnabled: false,
      checkpointsEnabled: false,
      doneNotifications: false,
    }),
  );
}

/** Recording AgentIO: send -> events[]; every permission request ALLOWED
 *  (covers write/command/mcp kinds — the mission's "auto-allow approvals"). */
function makeRecordingIo() {
  const events = [];
  const timeline = [];
  const ac = new AbortController();
  return {
    events,
    timeline,
    controller: ac,
    send(e) {
      timeline.push({ type: e.type, at: Date.now() });
      events.push(e);
    },
    async getDecision(requestId) {
      return { requestId, action: 'allow' };
    },
    isAborted: () => ac.signal.aborted,
    onFetchSignal(cb) {
      // mirror the register.ts bridge: hand over the external AbortSignal
      cb(ac.signal);
    },
  };
}

/** Derive the scenario artifacts from the recorded event stream. */
export function deriveResults(io) {
  const events = io.events;
  let lastToolResultIdx = -1;
  events.forEach((e, i) => {
    if (e.type === 'tool_result') lastToolResultIdx = i;
  });
  // The final answer = text deltas emitted after the last tool result.
  const finalText = events
    .filter((e, i) => e.type === 'text_delta' && i > lastToolResultIdx)
    .map((e) => e.text)
    .join('');
  const taskReport = [...events].reverse().find((e) => e.type === 'task_report') ?? null;
  const starts = events.filter((e) => e.type === 'tool_start');
  const resultsById = new Map(
    events.filter((e) => e.type === 'tool_result').map((e) => [e.toolCallId, e]),
  );
  const toolCalls = starts.map((s) => {
    const r = resultsById.get(s.toolCallId);
    return { name: s.name, args: s.args, ok: r ? r.ok : null, output: r ? r.output : null };
  });
  const toolsUsed = [...new Set(starts.map((s) => s.name))];
  const filesWritten = [
    ...new Set(
      starts
        .filter(
          (s) =>
            (s.name === 'write_file' || s.name === 'edit_file' || s.name === 'multi_edit') &&
            s.args &&
            typeof s.args.path === 'string',
        )
        .map((s) => s.args.path),
    ),
  ];
  const errors = events.filter((e) => e.type === 'error').map((e) => e.message);
  const todos = events.find((e) => e.type === 'todo')?.todos ?? null;
  return { events, finalText, taskReport, toolCalls, toolsUsed, filesWritten, errors, todos };
}

/**
 * Run ONE scripted scenario against the REAL engine.
 * @param {{
 *   name: string,
 *   prompt: string,
 *   model?: string,
 *   steps: Array<object>,
 *   workspace: string,
 *   timeoutMs?: number,
 *   mcpServers?: Array<object>,
 *   retryDelaysMs?: string,
 * }} opts
 * `steps` is the model script for `model` (see fake-provider.mjs). On timeout
 * the run is aborted and the promise REJECTS — a hung scenario is a failure.
 */
export async function runScenario({
  name,
  prompt,
  model = 'e2e-scripted-model',
  steps,
  workspace,
  timeoutMs = 180_000,
  mcpServers,
  retryDelaysMs = '10,10,10,10,10,10',
}) {
  const harness = await loadHarness();
  // Fast retry schedule so a desynced/exhausted script fails LOUD and FAST.
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = retryDelaysMs;

  const provider = createFakeProvider({ scripts: { [model]: [...steps] } });
  const port = await provider.port();
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  writeSettings(harness.userDataDir, baseUrl);

  const io = makeRecordingIo();
  const t0 = Date.now();
  let timer = null;
  try {
    const run = harness.engine.runAgent(
      {
        task: 'chat',
        sessionId: 'e2e-' + String(name).replace(/[^a-zA-Z0-9_-]+/g, '-'),
        messages: [{ id: 'm1', role: 'user', kind: 'text', content: prompt, timestamp: t0 }],
        model: { provider: 'custom', model, maxTokens: 8192 },
        mode: 'fullAccess',
        workspace,
        apiKey: 'test-key',
        baseUrl,
        ...(mcpServers ? { mcpServers } : {}),
      },
      io,
    );
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => {
        try {
          io.controller.abort();
        } catch {
          /* already aborting */
        }
        reject(new Error(`[runScenario "${name}"] timed out after ${timeoutMs}ms — aborted`));
      }, timeoutMs);
    });
    await Promise.race([run, guard]);
  } finally {
    if (timer) clearTimeout(timer);
    try {
      await provider.stop();
    } catch {
      /* stop is best-effort */
    }
  }

  return {
    name,
    durationMs: Date.now() - t0,
    providerRequests: provider.requests,
    providerServed: provider.served,
    providerExhausted: provider.exhausted,
    ...deriveResults(io),
  };
}
