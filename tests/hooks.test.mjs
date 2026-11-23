// Hooks engine unit tests — no LLM needed.
// Covers: config loading (workspace + home), matcher filtering,
// PreToolUse blocking (exit 2), context capture, timeout, and
// PostToolUse context annotation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, mkdtempSync } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

// Build a standalone ESM bundle of just the hooks module (keeps this test
// independent from the CLI bundle, which exits the process when imported).
// Portable: os.tmpdir() + fileURLToPath (URL.pathname is not a Windows path)
// + the esbuild JS shim (node_modules/.bin/esbuild is not executable on Win).
const TMP = mkdtempSync(path.join(tmpdir(), 'kodex-hooks-'));
const OUT = path.join(TMP, 'hooks-test.mjs');
execFileSync(
  ESBUILD_NODE,
  [ESBUILD_BIN, 'electron/agent/hooks.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${OUT}`],
  { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe' },
);
const hooks = await import(pathToFileURL(OUT).href);

// Helpers: workspaces with hooks.json must also carry the trust marker
// (.surnia/hooks-trusted) — the hooks engine ignores untrusted workspace hooks.
async function trust(dir) {
  await fs.writeFile(path.join(dir, '.surnia', 'hooks-trusted'), '');
}

test('loadHooks: empty workspace → empty config, no crash', async () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'kodex-hooks-empty-'));
  const cfg = await hooks.loadHooks(empty);
  assert.deepEqual(cfg.PreToolUse, []);
  assert.deepEqual(cfg.PostToolUse, []);
});

test('loadHooks: workspace .surnia/hooks.json parsed and cached', async () => {
  hooks.resetHookCache();
  await fs.mkdir(path.join(TMP, '.surnia'), { recursive: true });
  await fs.writeFile(
    path.join(TMP, '.surnia', 'hooks.json'),
    JSON.stringify({
      PreToolUse: [{ matcher: 'write_file|edit_file', command: 'echo pre-ok', timeoutMs: 5000 }],
      PostToolUse: [{ command: 'echo post-ok' }],
    }),
  );
  await trust(TMP);
  const cfg = await hooks.loadHooks(TMP);
  assert.equal(cfg.PreToolUse.length, 1);
  assert.equal(cfg.PostToolUse.length, 1);
});

test('loadHooks: workspace hooks WITHOUT .kodex/hooks-trusted are ignored (trust gate)', async () => {
  hooks.resetHookCache();
  const dir = mkdtempSync(path.join(tmpdir(), 'kodex-hooks-untrusted-'));
  await fs.mkdir(path.join(dir, '.surnia'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '.surnia', 'hooks.json'),
    JSON.stringify({ PreToolUse: [{ command: 'echo should-not-load' }] }),
  );
  const cfg = await hooks.loadHooks(dir);
  assert.deepEqual(cfg.PreToolUse, []);
  assert.deepEqual(cfg.PostToolUse, []);
});

test('PreToolUse: matcher filters other tools', async () => {
  const cfg = await hooks.loadHooks(TMP);
  const res = await hooks.runPreToolHooks(cfg, 'read_file', '{}', TMP, 's1');
  assert.equal(res.blocked, false);
  assert.equal(res.context, undefined); // echo never ran (matcher miss)
});

test('PreToolUse: matching tool gets context from stdout', async () => {
  const cfg = await hooks.loadHooks(TMP);
  const res = await hooks.runPreToolHooks(cfg, 'write_file', '{"path":"x"}', TMP, 's1');
  assert.equal(res.blocked, false);
  assert.equal(res.context, 'pre-ok');
});

test('PreToolUse: exit code 2 blocks with stderr reason', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kodex-hooks-block-'));
  await fs.mkdir(path.join(dir, '.surnia'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '.surnia', 'hooks.json'),
    JSON.stringify({ PreToolUse: [{ command: process.platform === 'win32'
      ? 'echo NO-WRITES-TO-TESTS 1>&2 & exit /b 2'
      : 'echo NO-WRITES-TO-TESTS >&2; exit 2' }] }),
  );
  await trust(dir);
  const cfg = await hooks.loadHooks(dir);
  const res = await hooks.runPreToolHooks(cfg, 'write_file', '{}', dir, 's2');
  assert.equal(res.blocked, true);
  assert.match(res.reason, /NO-WRITES-TO-TESTS/);
});

test('PreToolUse: hook receives JSON payload on stdin', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kodex-hooks-payload-'));
  await fs.mkdir(path.join(dir, '.surnia'), { recursive: true });
  // A tiny node script instead of a POSIX-quoted python -c: node ships with
  // the app everywhere, and cmd.exe does not understand shell single quotes.
  const reader = path.join(dir, 'hook-reader.cjs');
  await fs.writeFile(reader, "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log(d.tool,d.args.path);});\n");
  const payloadCmd = process.platform === 'win32'
    ? `node ${reader.replace(/\\/g, '/')}`
    : `node ${JSON.stringify(reader)}`;
  await fs.writeFile(
    path.join(dir, '.surnia', 'hooks.json'),
    JSON.stringify({ PreToolUse: [{ command: payloadCmd }] }),
  );
  await trust(dir);
  const cfg = await hooks.loadHooks(dir);
  const res = await hooks.runPreToolHooks(cfg, 'write_file', '{"path":"a.py"}', dir, 's3');
  assert.match(res.context, /write_file a\.py/);
});

test('PostToolUse: context annotation + failure is non-fatal', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kodex-hooks-post-'));
  await fs.mkdir(path.join(dir, '.surnia'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '.surnia', 'hooks.json'),
    JSON.stringify({ PostToolUse: [{ command: 'exit 3' }, { command: 'echo lint-clean' }] }),
  );
  await trust(dir);
  const cfg = await hooks.loadHooks(dir);
  const res = await hooks.runPostToolHooks(cfg, 'run_command', '{}', true, 'ok out', dir, 's4');
  assert.equal(res.blocked, false);
  assert.match(res.context, /lint-clean/);
});

test('PreToolUse: timeout is enforced (killed hook cannot block forever)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kodex-hooks-timeout-'));
  await fs.mkdir(path.join(dir, '.surnia'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '.surnia', 'hooks.json'),
    JSON.stringify({ PreToolUse: [{ command: process.platform === 'win32'
      ? 'ping -n 30 127.0.0.1 >nul'
      : 'sleep 30', timeoutMs: 400 }] }),
  );
  await trust(dir);
  const cfg = await hooks.loadHooks(dir);
  const t0 = Date.now();
  const res = await hooks.runPreToolHooks(cfg, 'write_file', '{}', dir, 's5');
  const dt = Date.now() - t0;
  assert.equal(res.blocked, false);
  assert.ok(dt < 5000, `hook should time out fast, took ${dt}ms`);
  assert.match(res.context, /hook exit 124|timed out/);
});
