// ============================================================================
// v11.42 — FULL TERMINAL AGENT (founder's honest feature gap).
//
// Founder: «انا لا نملك شو اسمه انه نقدر نشغل التطبيق بالترمينال… التطبيق
// يصير يشتغل بالترمينال» — SADEEM must be a real terminal agent, not a
// desktop-only app. This test drives the ACTUAL bundled cli.ts as a child
// process against a LOCAL scripted OpenAI-compatible provider (node:http on
// 127.0.0.1 — ZERO external network, ZERO real model) and proves:
//   1. `sadeem run "<task>"` → real tool call → real tool result → final
//      answer → honest REPORT, exit 0.
//   2. `sadeem` (no args) REPL accepts a typed line and answers it.
//   3. `help` / `version` / `config` / `models` work with no model call.
//   4. package.json exposes a `bin` so npm -g / npx can launch `sadeem`.
//
// Run: node --test --test-force-exit tests/v1142-cli.test.mjs
// ============================================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1142-'));
const userData = join(tmp, 'userdata');
const workspace = join(tmp, 'ws');
mkdirSync(userData, { recursive: true });
mkdirSync(workspace, { recursive: true });
const CLI = join(tmp, 'sadeem-cli.cjs');
const MAIN_MODEL = 'V1142-CLI-TEST';

function bundleCli() {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, 'electron/agent/cli.ts', '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${CLI}`, '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}
bundleCli();

after(() => {
  for (const s of sockets) s.destroy();
  try { server?.close(); } catch { /* best effort */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ---------- SSE helpers ----------
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'v1142-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
function finishSse(res, finish, usage) {
  if (!res.headersSent) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
  }
  if (usage) res.write(`data: ${JSON.stringify({ usage, choices: [] })}\n\n`);
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
const writeText = (res, text) => {
  for (const part of text.match(/[\s\S]{1,90}/g) ?? []) res.write(sseChunk({ content: part }));
};
const FINAL_ANSWER = 'DONE-V1142: the real terminal agent wrote the file and reported the result honestly.';
const TARGET = join(workspace, 'cli-agent-proof.txt');

// ---------- local scripted provider ----------
const requests = [];
const sockets = new Set();
let server;
let responder = null;

const providerReady = new Promise((resolve) => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      const sys = JSON.stringify(body.system ?? '');
      const isSecondary =
        body.model !== MAIN_MODEL ||
        /compact coding-agent transcripts/i.test(sys) ||
        /extract durable engineering facts|Surnia DNA user model/i.test(sys) ||
        /part of the Surnia agent team/i.test(sys);
      const n = requests.filter((r) => r.isMain).length + 1;
      requests.push({ model: body.model, isMain: !isSecondary, body });
      if (isSecondary) { finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 }); return; }
      try { (responder ?? defaultResponder)(res, n); }
      catch (err) { erroutMock(err); finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 }); }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
function erroutMock(err) { if (process.env.V1142_DEBUG) console.error('[mock provider]', err); }
function defaultResponder(res, n) {
  if (n === 1) {
    const args = JSON.stringify({ path: TARGET, content: 'written by sadeem run via the real engine\n' });
    for (const d of toolDeltas('write_file', args, 'call_v1142_1')) res.write(sseChunk(d));
    finishSse(res, 'tool_calls', { prompt_tokens: 80, completion_tokens: 40 });
    return;
  }
  writeText(res, FINAL_ANSWER);
  finishSse(res, 'stop', { prompt_tokens: 60, completion_tokens: 30 });
}
const PORT = await providerReady;
const BASE = `http://127.0.0.1:${PORT}/v1`;

function writeSettings() {
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    schemaVersion: 4,
    language: 'en',
    dnaEnabled: false,
    checkpointsEnabled: false,
    model: { provider: 'custom', model: MAIN_MODEL },
    providers: { custom: { apiKey: 'test-key', baseUrl: BASE, enabled: true } },
    agent: {
      maxRetries: 0, autoCompact: false, autoVerify: false, selfCritique: false,
      autoMemory: false, checkpointsEnabled: false, allowModelFailover: false,
      toolProfile: 'full',
    },
    doneNotifications: false,
  }));
}
writeSettings();

const ENV = {
  ...process.env,
  SURNIA_HOME: userData,
  SURNIA_DELTA_FLUSH_MS: '5',
  SURNIA_TURN_RETRY_DELAYS_MS: '5,5,5,5,5,5',
  SURNIA_SKIP_UI_GATE: '1',
  SADEEM_CLI_YES: '1',
};

function runCli(args, { input = '', timeout = 90000, env = ENV } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeout);
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + String(err) }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}
function resetProvider(fn = defaultResponder) {
  responder = fn;
  requests.length = 0;
}

// ===========================================================================
test('v1142: help / version / config / models work with NO model call', async () => {
  resetProvider();
  const help = await runCli(['help']);
  assert.equal(help.code, 0, `help exit: ${help.stderr}`);
  assert.match(help.stdout, /sadeem run "<task>"/);
  assert.match(help.stdout, /npm i -g sadeem && sadeem run/);
  assert.match(help.stdout, /interactive REPL/);

  const version = await runCli(['version']);
  assert.equal(version.code, 0);
  assert.match(version.stdout, /^sadeem 11\.12\.0/m);

  const config = await runCli(['config']);
  assert.equal(config.code, 0, `config exit: ${config.stderr}`);
  assert.match(config.stdout, /settings\.json/);
  assert.match(config.stdout, /provider\s+:/);
  assert.doesNotMatch(config.stdout, /test-key/, 'config NEVER prints the full API key');

  const models = await runCli(['models']);
  assert.equal(models.code, 0, `models exit: ${models.stderr}`);
  assert.match(models.stdout, /Configured:/);
  assert.match(models.stdout, /Anthropic/);
  assert.equal(requests.length, 0, 'help/version/config/models never call the provider');
});

test('v1142: `sadeem run` executes a REAL turn — tool call, tool result, final answer, report', async () => {
  resetProvider();
  try { rmSync(TARGET, { force: true }); } catch { /* best effort */ }
  const r = await runCli(['run', 'Create the proof file, then tell me what you did.', '--workspace', workspace]);
  if (process.env.V1142_DEBUG) console.error('--- STDOUT ---\n' + r.stdout + '\n--- STDERR ---\n' + r.stderr);
  assert.equal(r.code, 0, `run exit must be 0 (stderr: ${r.stderr.slice(-1500)})`);
  assert.match(r.stdout, /▸ write_file/, 'the real tool call was rendered in the terminal');
  assert.match(r.stdout, /✓/, 'the real tool result was rendered in the terminal');
  assert.ok(existsSync(TARGET), 'the tool really wrote the file on disk');
  assert.match(readFileSync(TARGET, 'utf8'), /written by sadeem run/);
  assert.ok(r.stdout.includes(FINAL_ANSWER), 'the model final answer reached the terminal');
  assert.match(r.stdout, /REPORT/i, 'the honest completion report was printed');
  assert.match(r.stdout, /completed/i);
  const mainRequests = requests.filter((x) => x.isMain);
  assert.ok(mainRequests.length >= 2, `the engine really looped: tool turn + answer turn (got ${mainRequests.length})`);
});

test('v1142: interactive REPL accepts a typed line and responds', async () => {
  // One scripted turn: tool call → final answer, then the user types /exit.
  resetProvider();
  const r = await runCli(['--workspace', workspace], { input: 'Create the proof file and summarize.\n/exit\n' });
  if (process.env.V1142_DEBUG) console.error('--- REPL STDOUT ---\n' + r.stdout + '\n--- REPL STDERR ---\n' + r.stderr);
  assert.equal(r.code, 0, `REPL exit: ${r.stderr.slice(-1000)}`);
  assert.match(r.stdout, /interactive agent/i, 'REPL banner printed');
  assert.ok(r.stdout.includes(FINAL_ANSWER), 'REPL answered the typed line with the real engine');
  assert.match(r.stdout, /turn ok/i, 'REPL reported a completed turn');
  assert.ok(requests.some((x) => x.isMain), 'REPL actually called the provider');
});

test('v1142: --mode default prints a REAL approval in the terminal and accepts "y"', async () => {
  resetProvider();
  try { rmSync(TARGET, { force: true }); } catch { /* best effort */ }
  const env = { ...ENV, SADEEM_CLI_YES: '0', KODEX_MODE: 'default' };
  const r = await runCli(['run', 'Write the proof file and tell me the result.', '--workspace', workspace], {
    input: 'y\n', env,
  });
  if (process.env.V1142_DEBUG) console.error('--- APPROVAL STDOUT ---\n' + r.stdout + '\n--- STDERR ---\n' + r.stderr);
  assert.equal(r.code, 0, `default-mode run exit: ${r.stderr.slice(-1200)}`);
  assert.match(r.stdout, /APPROVAL/i, 'a real approval card was printed in the terminal');
  assert.match(r.stdout, /▸ write_file/, 'the approved tool then really ran');
  assert.ok(existsSync(TARGET), 'the approved write landed on disk');
  assert.ok(r.stdout.includes(FINAL_ANSWER), 'the run continued to the final answer after approval');
});

test('v1142: missing key gives a TERMINAL-specific fix, not "open Settings"', async () => {
  resetProvider();
  const emptyHome = join(tmp, 'empty-home');
  mkdirSync(emptyHome, { recursive: true });
  const env = { ...ENV, SURNIA_HOME: emptyHome, KODEX_API_KEY: '', KODEX_PROVIDER: '' };
  const r = await runCli(['run', 'hello', '--provider', 'openai'], { env });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /No API key for "openai"/);
  assert.match(r.stdout, /KODEX_API_KEY/);
  assert.doesNotMatch(r.stdout, /Open Settings → AI providers, paste/);
  assert.equal(requests.length, 0, 'preflight fails before any network call');
});

test('v1142: npm global install surface — package.json bin points at the built CLI', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.bin?.sadeem, 'dist-cli/surnia.cjs');
  assert.equal(pkg.bin?.kodex, 'dist-cli/kodex.cjs');
  assert.match(pkg.scripts?.['build:cli'] ?? '', /cli\.ts/);
  assert.ok(pkg.scripts?.['test:cli'], 'test:cli script exists for CI');
  if (existsSync(join(ROOT, 'dist-cli', 'surnia.cjs'))) {
    assert.match(readFileSync(join(ROOT, 'dist-cli', 'surnia.cjs'), 'utf8').slice(0, 40), /^#!\/usr\/bin\/env node/, 'bin has a node shebang');
  }
});
