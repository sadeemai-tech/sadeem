import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// v11.10 — SURFACE fixes test suite (Task A6): the three founder complaints,
// each exercised END-TO-END against the REAL main-process code:
//
//   1. APPROVALS  — "I tell it ALWAYS allow, it keeps asking again and again":
//      • a bare ALWAYS with the per-tool scope ("echo") persists to the SAME
//        approval-rules.json store the engine gate writes (engine.ts untouched);
//      • a SECOND runAgent run (NEW sessionId, mode 'default') auto-approves a
//        different command from the SAME tool WITHOUT any dialog — the persisted
//        rule is checked BEFORE the approval card and never re-prompts;
//      • the store round-trip is listable/revocable via approvalPolicyService
//        (Settings → Approvals backend).
//   2. TERMINAL   — real streaming shell round trip: create → exec
//      `echo SADEEM_TERMINAL_OK` → output reaches the simulated renderer
//      handler; cwd tracking works; the RAW STDIN BRIDGE (v11.10, the
//      "terminal does not work" fix for prompts/REPLs) reaches a live child.
//   3. LIVE PREVIEW — staticStart serves the workspace: real fetch → HTTP 200
//      + correct content-type; devStart runs a real dev script, parses the
//      printed URL from stdout and the dev URL answers 200.
//
// Self-bootstrapping: bundles electron/{services,agent} + src/lib/modes with
// esbuild (same posture as v119-engine / v1110-endurance). No network — the
// "provider" is a scripted local mock (node:http).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1110-surface-'));

// ---------- esbuild bundle (same flags as the other harnesses) ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, 
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
  ], { cwd: ROOT, stdio: 'pipe' });
}

// ---------- electron stub with an ISOLATED userData dir ----------
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
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
  };`,
);

// ---------- bundles ----------
const engPath = join(tmp, 'engine.cjs');
bundle('electron/agent/engine.ts', engPath);
const engine = require(engPath);

const policyPath = join(tmp, 'policy.cjs');
bundle('electron/services/approvalPolicyService.ts', policyPath);
const policy = require(policyPath);

const modesPath = join(tmp, 'modes.cjs');
bundle('src/lib/modes.ts', modesPath);
const modes = require(modesPath);

// ============================================================
// shared mock provider (OpenAI-compatible SSE, scripted per model)
// ============================================================
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
function sseHeaders(res) { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.flushHeaders(); }
function finishSse(res, finish = 'stop') {
  res.write(sseChunk({}, finish));
  res.write('data: [DONE]\n\n');
  res.end();
}
function toolDeltas(name, args, id) {
  const half = Math.max(1, Math.floor(args.length / 2));
  return [
    { tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(0, half) } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] },
  ];
}

function startMock() {
  const routes = new Map(); // model → handler queue
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      const q = routes.get(body.model);
      const h = q && q.length ? q.shift() : null;
      if (!h) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `UNSCRIPTED request for model ${body.model}` } }));
        return;
      }
      try { await h({ res, req, body }); } catch { try { res.destroy(); } catch { /* gone */ } }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return {
    routes,
    port: () => listening,
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

// ---------- engine harness ----------
const workspace = join(tmp, 'ws');
mkdirSync(workspace, { recursive: true });

function writeSettings(mockBase) {
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 4,
      providers: { custom: { apiKey: 'test-key', baseUrl: mockBase } },
      agent: { maxRetries: 0, autoCompact: false, autoVerify: false },
      doneNotifications: false,
    }),
  );
}

function makeIo(decisions) {
  const events = [];
  const decisionLog = [];
  let i = 0;
  return {
    events,
    decisionLog,
    send(e) { events.push(e); },
    async getDecision(requestId) {
      const d = i < decisions.length ? decisions[i++] : { action: 'allow' };
      decisionLog.push({ requestId, ...d });
      return { requestId, ...d };
    },
    isAborted: () => false,
    onFetchSignal() {},
  };
}

async function runEngine({ baseUrl, io, sessionId }) {
  await engine.runAgent(
    {
      task: 'chat',
      sessionId,
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Run the commands.', timestamp: Date.now() }],
      model: { provider: 'custom', model: 'mock-a', maxTokens: 2048 },
      mode: 'default', // ASK mode — nothing is auto-approved, so the test proves the RULE did it
      workspace,
      apiKey: 'test-key',
      baseUrl,
    },
    io,
  );
}

const approvals = (io) => io.events.filter((e) => e.type === 'approval_request');
const approvalFor = (io, frag) => approvals(io).find((e) => String(e.detail ?? '').includes(frag));

// ============================================================
// 1) APPROVALS — persistence + never-re-prompt round trip
// ============================================================
test('surface/approvals: bare ALWAYS stores the PER-TOOL scope in the shared store and never re-prompts (new session, same tool)', async () => {
  const mock = startMock();
  const base = `http://127.0.0.1:${await mock.port()}`;
  writeSettings(base);

  // scope derivation unit contract (what the renderer sends as decision.value)
  assert.equal(modes.deriveToolScope('echo SADEEM_ALWAYSA'), 'echo');
  assert.equal(modes.deriveToolScope('FOO=1 npm install express'), 'npm');
  assert.equal(modes.deriveToolScope('cd app && npm run dev'), 'cd');

  // ---- run 1: echo → user clicks ALWAYS (renderer derives scope "echo") ----
  mock.routes.set('mock-a', [
    async ({ res }) => {
      sseHeaders(res);
      for (const d of toolDeltas('run_command', JSON.stringify({ command: 'echo SADEEM_ALWAYSA' }), 'call_1')) {
        res.write(sseChunk(d));
      }
      finishSse(res, 'tool_calls');
    },
    async ({ res }) => {
      sseHeaders(res);
      res.write(sseChunk({ content: 'done' }));
      finishSse(res);
    },
  ]);
  const io1 = makeIo([{ action: 'always', value: modes.deriveToolScope('echo SADEEM_ALWAYSA') }]);
  await runEngine({ baseUrl: base, io: io1, sessionId: 'sess-1' });
  assert.equal(approvals(io1).length, 1, 'exactly ONE approval dialog in run 1');
  assert.equal(io1.decisionLog[0].action, 'always');

  // ---- the SAME store the engine gate writes now holds cmd:echo ----
  const storeFile = join(userDataDir, 'approval-rules.json');
  assert.ok(existsSync(storeFile), 'approval-rules.json exists in userData');
  const store = JSON.parse(readFileSync(storeFile, 'utf8'));
  const wsHash = Object.keys(store)[0];
  assert.ok(store[wsHash]['cmd:echo'], 'per-tool rule cmd:echo persisted');

  // ---- run 2: a DIFFERENT command from the SAME tool, NEW session ----
  // mode is still 'default' — ONLY the persisted rule can auto-approve this.
  let decisionCalls = 0;
  mock.routes.set('mock-a', [
    async ({ res }) => {
      sseHeaders(res);
      for (const d of toolDeltas('run_command', JSON.stringify({ command: 'echo SADEEM_ALWAYSB' }), 'call_2')) {
        res.write(sseChunk(d));
      }
      finishSse(res, 'tool_calls');
    },
    async ({ res }) => {
      sseHeaders(res);
      res.write(sseChunk({ content: 'done 2' }));
      finishSse(res);
    },
  ]);
  const io2 = makeIo([]);
  io2.getDecision = async (requestId) => {
    decisionCalls++;
    return { requestId, action: 'allow' };
  };
  await runEngine({ baseUrl: base, io: io2, sessionId: 'sess-2-NEW' });
  assert.equal(decisionCalls, 0, 'NO dialog in run 2 — the persisted rule is checked BEFORE any dialog');
  assert.equal(approvals(io2).length, 0, 'no approval_request event fired');

  await mock.stop();
});

test('surface/approvals: policy service lists + revokes rules from the SAME store (Settings → Approvals backend)', () => {
  const listed = policy.list(workspace);
  assert.ok(listed.total >= 1, 'the persisted rule is visible to the settings UI');
  const allow = listed.groups.flatMap((g) => g.rules).find((r) => r.allow && r.key === 'cmd:echo');
  assert.ok(allow, 'cmd:echo listed as an always-allow rule');

  const revoked = policy.revoke(workspace, 'cmd:echo');
  assert.equal(revoked, 1, 'revoke removes exactly one rule');
  const after = policy.list(workspace);
  assert.ok(!after.groups.flatMap((g) => g.rules).some((r) => r.key === 'cmd:echo'), 'rule gone after revoke');
});

// ============================================================
// 2) TERMINAL — real streaming shell round trip + raw stdin bridge
// ============================================================
test('surface/terminal: echo round trip reaches the simulated renderer handler; cwd + guard pass-through', async () => {
  const termPath = join(tmp, 'terminal.cjs');
  bundle('electron/services/terminalService.ts', termPath);
  const term = require(termPath);

  const chunks = [];
  term.setOnData((e) => chunks.push(e)); // THE simulated renderer handler

  const id = term.create(workspace);
  await term.exec(id, 'echo SADEEM_TERMINAL_OK');

  let seen = '';
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100));
    seen = chunks.filter((c) => c.terminalId === id).map((c) => c.data).join('');
    if (seen.includes('SADEEM_TERMINAL_OK')) break;
  }
  assert.ok(seen.includes('SADEEM_TERMINAL_OK'), `renderer received the command output (got: ${JSON.stringify(seen.slice(0, 120))})`);
  // the SOH marker protocol never leaks to the UI
  assert.ok(!seen.includes('\u0001'), 'no marker bytes leak to the renderer');
  // a plain echo is not guard-blocked
  assert.ok(!seen.includes('blocked by terminal guard'), 'ordinary commands are not guard-blocked');

  // cwd tracking: change directory, next command inherits it.
  // `/tmp`/`pwd` are POSIX-only; use the platform's temp dir + `cd` on Windows.
  const probeDir = process.platform === 'win32' ? tmp : '/tmp';
  const cdCmd = process.platform === 'win32'
    ? `cd /d ${probeDir.replace(/\\/g, '/')} & cd`
    : 'cd /tmp && pwd';
  chunks.length = 0;
  await term.exec(id, cdCmd);
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100));
    seen = chunks.filter((c) => c.terminalId === id).map((c) => c.data).join('');
    if (seen.includes(probeDir)) break;
  }
  assert.ok(seen.includes(probeDir), 'cwd tracking works');

  term.disposeAll();
});

test('surface/terminal: v11.10 stdin bridge answers a RUNNING child (the npm-init/REPL fix)', async () => {
  const termPath = join(tmp, 'terminal2.cjs');
  bundle('electron/services/terminalService.ts', termPath);
  const term = require(termPath);

  // a script that reads stdin and answers — the mock of `npm init` prompts
  const script = join(tmp, 'readline.js');
  writeFileSync(script, `process.stdin.setEncoding('utf8');process.stdin.on('data',(d)=>{process.stdout.write('STDIN_GOT:'+d.trim()+'\\n');});`);

  const chunks = [];
  term.setOnData((e) => chunks.push(e));
  const id = term.create(tmp);
  // Quoting a Windows path with JSON.stringify (escaped \\) breaks cmd.exe /s;
  // forward slashes are accepted by node.exe and need no shell quoting.
  await term.exec(id, `node ${script.replace(/\\/g, '/')}`);
  await new Promise((r) => setTimeout(r, 400)); // let the child start listening

  const forwarded = term.write(id, 'hello-bridge\n');
  assert.equal(forwarded, true, 'keystrokes forwarded to the running child');

  let seen = '';
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 100));
    seen = chunks.filter((c) => c.terminalId === id).map((c) => c.data).join('');
    if (seen.includes('STDIN_GOT:hello-bridge')) break;
  }
  assert.ok(seen.includes('STDIN_GOT:hello-bridge'), `child received stdin (got: ${JSON.stringify(seen.slice(0, 120))})`);

  // no live child → false (renderer falls back to local line editing)
  await term.interrupt(id);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(term.write(id, 'x'), false, 'write() is inert with no running child');
  term.disposeAll();
});

// ============================================================
// 3) LIVE PREVIEW — static HTTP 200 + dev-server URL adoption
// ============================================================
test('surface/preview: static serve answers real HTTP 200 with the right content-type; dev server URL parsed and served', async () => {
  const previewPath = join(tmp, 'preview.cjs');
  bundle('electron/services/previewService.ts', previewPath);
  const preview = require(previewPath);

  const ws = join(tmp, 'site');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'index.html'), '<!doctype html><html><body><h1>SADEEM PREVIEW OK</h1></body></html>');
  writeFileSync(join(ws, 'app.js'), 'console.log("js");\n');

  // ---- static ----
  const st = await preview.staticStart(ws, 0);
  assert.ok(st.ok, `staticStart ok: ${JSON.stringify(st)}`);
  const res = await fetch(st.url + '/index.html');
  assert.equal(res.status, 200, 'index.html → HTTP 200');
  assert.match(res.headers.get('content-type') ?? '', /text\/html/, 'correct content-type');
  const body = await res.text();
  assert.ok(body.includes('SADEEM PREVIEW OK'), 'the workspace content is actually served');
  const resJs = await fetch(st.url + '/app.js');
  assert.equal(resJs.status, 200, 'app.js → HTTP 200');
  assert.match(resJs.headers.get('content-type') ?? '', /(application|text)\/javascript/, 'js MIME correct');
  preview.staticStop();

  // ---- dev: real script that prints its URL (the stdout parse path) ----
  writeFileSync(join(ws, 'dev.js'), [
    'const http = require("http");',
    'const s = http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/plain" }); r.end("DEV-OK"); });',
    "s.listen(0, '127.0.0.1', () => console.log('  ➜  Local:   http://127.0.0.1:' + s.address().port + '/'));",
  ].join('\n'));
  writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'x', scripts: { dev: 'node dev.js' } }));

  const dv = await preview.devStart(ws, 'npm');
  assert.ok(dv.ok, `devStart ok: ${JSON.stringify(dv)}`);
  let devUrl = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const s = preview.devStatus();
    if (s.state === 'ready' && s.url) { devUrl = s.url; break; }
  }
  assert.ok(devUrl, 'devStatus becomes ready with the REAL parsed URL');
  const devRes = await fetch(devUrl);
  assert.equal(devRes.status, 200, 'dev URL → HTTP 200');
  assert.equal(await devRes.text(), 'DEV-OK', 'dev server content correct');
  preview.devStop();

  // ---- honest failure: no package.json → error, not a hang ----
  const empty = join(tmp, 'emptyws');
  mkdirSync(empty, { recursive: true });
  const fail = await preview.devStart(empty, 'npm');
  assert.equal(fail.ok, false, 'devStart fails honestly with no package.json');
  assert.match(fail.error ?? '', /package\.json/, 'error names the reason');
});
