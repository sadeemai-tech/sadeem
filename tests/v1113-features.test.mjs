import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

// ============================================================
// v11.13 — REAL composer capabilities:
//   /diff [path] · /test [cmd] · /explain <path>
//   /skills on|off|list · /mcp list|test <id> · /budget
// plus the real copy-to-clipboard output panel and the always-visible
// stop/abort button. Store tests use the SAME esbuild-bundle + mock-bridge
// pattern as tests/v1112-chat-capabilities.test.mjs.
//   node --test --test-force-exit tests/v1113-features.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1113-'));

function bundle(entry, out) {
  execFileSync(
    ESBUILD_NODE,
    [
      ESBUILD_BIN,
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

// ---- mock window.surnia bridge (installed BEFORE the store bundle loads) ----
const calls = [];
const mock = {
  repo: true,
  pkg: JSON.stringify({ scripts: { test: 'node --test' } }),
  cmdResult: { ok: true, code: 0, stdout: '1..4\n# pass 4', stderr: '', ms: 21 },
  health: { id: 's1', state: 'connected', toolCount: 3, latencyMs: 9 },
  skills: [{ slug: 'deploy', name: 'Deploy', description: 'Deploy checklist', path: '/x', scope: 'workspace' }],
  servers: [{ id: 's1', name: 'S1', state: 'connected', toolCount: 3 }],
};
const bridge = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === 'then' || typeof key === 'symbol') return undefined;
      return (...args) => {
        calls.push({ key, args });
        switch (key) {
          case 'gitStatus':
            return Promise.resolve(mock.repo ? { isRepo: true, branch: 'main', changed: [] } : null);
          case 'gitDiff':
            return Promise.resolve([{ path: 'a.ts', patch: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n+hello' }]);
          case 'readFile': {
            const p = String(args[0] ?? '');
            return Promise.resolve(p.endsWith('package.json') ? mock.pkg : 'export const x = 1;');
          }
          case 'cmdRun':
            return Promise.resolve({ cmd: args[0], cwd: args[1], ...mock.cmdResult });
          case 'aiComplete':
            return Promise.resolve('This file exports a constant x. It is a tiny demo module.');
          case 'mcpServersGet':
            return Promise.resolve({ servers: mock.servers, presets: [], totalTools: 3 });
          case 'mcpHealthCheck':
            return Promise.resolve(mock.health);
          case 'skillsList':
            return Promise.resolve(mock.skills);
          case 'skillsTrust':
            return Promise.resolve({ ok: true });
          case 'previewStatus':
            return Promise.resolve({ dev: { running: false, state: 'idle', lines: [] }, static: { running: false }, ports: [] });
          default:
            return Promise.resolve(undefined);
        }
      };
    },
  },
);
globalThis.window = { surnia: bridge }; // no confirm() → guarded confirms treated as OK
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const storePath = join(tmp, 'store.cjs');
bundle('src/store.ts', storePath);
const useStore = require(storePath).useStore;
const ws = join(tmp, 'ws');

function seed(extra = {}) {
  const prev = useStore.getState();
  useStore.setState({
    wsPath: ws,
    session: {
      id: 's1', title: 't', workspace: ws, messages: [], createdAt: Date.now(),
      updatedAt: Date.now(), messageCount: 0, totalTokens: 0, totalCostUsd: 0,
    },
    settings: {
      ...prev.settings,
      language: 'en',
      model: { provider: 'custom', model: 'm' },
      providers: { ...(prev.settings.providers ?? {}), custom: { apiKey: 'k', baseUrl: 'http://127.0.0.1:1' } },
    },
    running: false,
    capabilityPanel: null,
    sessionUsage: { inputTokens: 100, outputTokens: 50, costUsd: 0.01 },
    lastTurnUsage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
    ...extra,
  });
  return ws;
}
const had = (key, predicate = () => true) => calls.some((c) => c.key === key && predicate(c.args));
const resetCalls = () => (calls.length = 0);
const msgs = () => useStore.getState().session?.messages ?? [];

// ------------------------------------------------------------
// capability 1 — /diff [path]
// ------------------------------------------------------------
test('/diff [path] shows a real unified diff in a copyable output panel + transcript', async () => {
  seed();
  resetCalls();
  await useStore.getState().sendMessage('/diff src/a.ts');
  assert.ok(had('gitStatus', (a) => a[0] === ws), 'repo checked before diffing');
  assert.ok(had('gitDiff', (a) => a[0] === ws && a[1] === 'src/a.ts'), 'path forwarded to git diff service');
  const panel = useStore.getState().capabilityPanel;
  assert.equal(panel?.kind, 'diff', 'output panel opened');
  assert.match(panel?.text ?? '', /^\+hello/m, 'panel carries the REAL patch text');
  assert.ok(msgs().some((m) => /```diff/.test(m.content)), 'transcript panel carries a fenced diff block');
  assert.ok(useStore.getState().notice, 'visible toast fired');
});

test('/diff reports honestly when no git repo is open', async () => {
  seed({ wsPath: '' });
  resetCalls();
  await useStore.getState().sendMessage('/diff');
  assert.equal(had('gitDiff'), false, 'no bridge call without a workspace');
  assert.match(useStore.getState().notice || '', /Open a folder first/);

  seed();
  mock.repo = false;
  resetCalls();
  await useStore.getState().sendMessage('/diff');
  mock.repo = true;
  assert.match(useStore.getState().notice || '', /No git repository/);
});

// ------------------------------------------------------------
// capability 2 — /test [cmd]
// ------------------------------------------------------------
test('/test detects the project script and renders the REAL exit-code verdict', async () => {
  seed();
  resetCalls();
  await useStore.getState().sendMessage('/test');
  assert.ok(had('cmdRun', (a) => a[0] === 'npm run test' && a[1] === ws), 'detected script run via kdx:cmd:run');
  const panel = useStore.getState().capabilityPanel;
  assert.equal(panel?.kind, 'test');
  assert.match(panel?.text ?? '', /PASS — exit code 0/, 'verdict comes from real exit code');
  assert.match(panel?.text ?? '', /# pass 4/, 'real stdout captured');
  assert.ok(msgs().some((m) => /PASS — exit code 0/.test(m.content)), 'verdict in the transcript');
});

test('/test [cmd] honors an explicit command and reports a FAIL verdict honestly', async () => {
  seed();
  mock.cmdResult = { ok: false, code: 1, stdout: '', stderr: 'assertion failed', ms: 7 };
  resetCalls();
  await useStore.getState().sendMessage('/test npm run custom');
  assert.ok(had('cmdRun', (a) => a[0] === 'npm run custom'), 'explicit command forwarded');
  assert.match(useStore.getState().capabilityPanel?.text ?? '', /FAIL — exit code 1/);
  assert.match(useStore.getState().capabilityPanel?.text ?? '', /assertion failed/);
  mock.cmdResult = { ok: true, code: 0, stdout: '1..4\n# pass 4', stderr: '', ms: 21 };
});

test('/test refuses to invent a command when the project declares none', async () => {
  seed({ fileTree: null });
  mock.pkg = '{}';
  resetCalls();
  await useStore.getState().sendMessage('/test');
  mock.pkg = JSON.stringify({ scripts: { test: 'node --test' } });
  assert.equal(had('cmdRun'), false, 'no fabricated command');
  assert.match(useStore.getState().notice || '', /No test command found/);
});

// ------------------------------------------------------------
// capability 3 — /explain <path>
// ------------------------------------------------------------
test('/explain reads the real file and runs a real one-shot model turn', async () => {
  seed();
  resetCalls();
  await useStore.getState().sendMessage('/explain src/a.ts');
  assert.ok(had('readFile', (a) => String(a[0]).endsWith('/src/a.ts')), 'file read through the fs bridge');
  assert.ok(had('aiComplete', (a) => String(a[0]).includes('export const x = 1;')), 'real file content sent to the model');
  const panel = useStore.getState().capabilityPanel;
  assert.equal(panel?.kind, 'explain');
  assert.match(panel?.text ?? '', /exports a constant x/, 'model explanation captured');
  assert.ok(msgs().some((m) => /Explanation of/.test(m.content)), 'explanation in transcript');
});

test('/explain without a path reports usage (no fake explanation)', async () => {
  seed();
  resetCalls();
  await useStore.getState().sendMessage('/explain');
  assert.equal(had('readFile'), false);
  assert.match(useStore.getState().notice || '', /Usage: \/explain/);
});

// ------------------------------------------------------------
// capability 4 — /skills on|off|list
// ------------------------------------------------------------
test('/skills toggles the REAL workspace skill-injection gate and persists it', async () => {
  seed();
  resetCalls();
  await useStore.getState().sendMessage('/skills off');
  assert.equal(useStore.getState().settings.trustWorkspaceSkills, 'never', 'gate off persisted');
  assert.ok(had('saveSettings'), 'written to the main-process settings store');

  resetCalls();
  await useStore.getState().sendMessage('/skills on');
  assert.equal(useStore.getState().settings.trustWorkspaceSkills, 'always', 'gate on persisted');
  assert.ok(had('skillsTrust', (a) => a[0] === ws), 'workspace trust marker written');
  assert.equal(useStore.getState().capabilityPanel?.kind, 'skills');
});

test('/skills list lists real skills and bare /skills reports the real state', async () => {
  seed();
  resetCalls();
  await useStore.getState().sendMessage('/skills list');
  assert.ok(had('skillsList', (a) => a[0] === ws));
  assert.match(useStore.getState().capabilityPanel?.text ?? '', /Deploy/);

  resetCalls();
  await useStore.getState().sendMessage('/skills');
  assert.equal(had('skillsList'), false);
  assert.match(useStore.getState().capabilityPanel?.text ?? '', /Skill injection:/);
  assert.match(useStore.getState().capabilityPanel?.text ?? '', /on|off|ask on use/);
});

test('/skills rejects an unknown subcommand', async () => {
  seed();
  await useStore.getState().sendMessage('/skills bananas');
  assert.match(useStore.getState().notice || '', /Usage: \/skills/);
});

// ------------------------------------------------------------
// capability 5 — /mcp list|test <id>
// ------------------------------------------------------------
test('/mcp list lists real configured servers with their status', async () => {
  seed();
  resetCalls();
  await useStore.getState().sendMessage('/mcp list');
  assert.ok(had('mcpServersGet'));
  const panel = useStore.getState().capabilityPanel;
  assert.equal(panel?.kind, 'mcp');
  assert.match(panel?.text ?? '', /s1 — connected · 3 tools/);
});

test('/mcp test <id> runs the real health check and reports the real state', async () => {
  seed();
  resetCalls();
  await useStore.getState().sendMessage('/mcp test s1');
  assert.ok(had('mcpHealthCheck', (a) => a[0] === 's1'), 'health check called for the given id');
  assert.match(useStore.getState().capabilityPanel?.text ?? '', /s1 is connected — 3 tool\(s\), 9 ms/);

  resetCalls();
  await useStore.getState().sendMessage('/mcp test nope');
  assert.match(useStore.getState().notice || '', /No MCP server matches/);
});

// ------------------------------------------------------------
// capability 6 — /budget
// ------------------------------------------------------------
test('/budget reports real session usage numbers (no invented figures)', async () => {
  seed();
  resetCalls();
  await useStore.getState().sendMessage('/budget');
  const panel = useStore.getState().capabilityPanel;
  assert.equal(panel?.kind, 'budget');
  assert.match(panel?.text ?? '', /100 in \/ 50 out/, 'real session token totals');
  assert.match(panel?.text ?? '', /\$0\.0100/, 'real session cost');
  assert.match(panel?.text ?? '', /Last turn: 15 tokens/, 'real last-turn delta');
  // No bridge needed — every number comes from the in-renderer usage store.
  assert.equal(calls.some((c) => ['cmdRun', 'aiComplete', 'gitDiff'].includes(c.key)), false);
});

// ------------------------------------------------------------
// wiring / i18n / backend (source-level)
// ------------------------------------------------------------
test('all six capabilities are wired into the slash menu and the store dispatcher', () => {
  const composer = readFileSync(join(ROOT, 'src', 'components', 'Composer.tsx'), 'utf8');
  const store = readFileSync(join(ROOT, 'src', 'store.ts'), 'utf8');
  for (const cmd of ['/diff', '/test', '/explain', '/skills', '/mcp', '/budget']) {
    assert.ok(composer.includes(`cmd: '${cmd}'`), `slash menu registers ${cmd}`);
  }
  for (const [cmd, action] of [
    ['diff', 'showDiff'],
    ['test', 'runTests'],
    ['explain', 'explainFile'],
    ['skills', 'skillsCommand'],
    ['mcp', 'mcpCommand'],
    ['budget', 'budgetCommand'],
  ]) {
    assert.ok(store.includes(`cmd === '${cmd}'`), `store dispatcher handles /${cmd}`);
    assert.ok(store.includes(`get().${action}(`), `store action ${action} is invoked`);
  }
  // the copy button is real, not decoration
  assert.match(composer, /navigator\.clipboard\.writeText/, 'real clipboard write');
  assert.match(composer, /capabilityPanel\.text/, 'panel renders captured output');
  assert.match(composer, /data-testid="composer-stop"/, 'stop button always visible while running');
  assert.match(composer, /void abortAgent\(\)/, 'stop button aborts the real run');
});

test('/test backend is a real exit-code IPC channel wired end-to-end', () => {
  const ipc = readFileSync(join(ROOT, 'electron', 'ipc.ts'), 'utf8');
  const preload = readFileSync(join(ROOT, 'electron', 'preload.ts'), 'utf8');
  const api = readFileSync(join(ROOT, 'src', 'lib', 'api.ts'), 'utf8');
  const types = readFileSync(join(ROOT, 'shared', 'types.ts'), 'utf8');
  assert.match(ipc, /['"]kdx:cmd:run['"]/, 'main registers kdx:cmd:run');
  // SECURITY: the v11.13 hardening replaced shell:true with an allow-listed,
  // approve-gated spawn. Lock the safe shape in instead of the old unsafe one.
  assert.match(ipc, /shell:\s*false/, 'no shell is used');
  assert.match(ipc, /CMD_RUN_ALLOW/, 'test-runner allow-list exists');
  assert.match(ipc, /APPROVAL_REQUIRED/, 'approval is mandatory');
  assert.match(ipc, /assertSafePath\(dir/, 'cwd is jailed');
  assert.match(preload, /cmdRun:.*invoke\('kdx:cmd:run'/, 'preload exposes cmdRun');
  assert.match(api, /cmdRun\(cmd: string, cwd: string/, 'typed bridge declares cmdRun');
  assert.match(types, /export interface CommandRunResult/, 'shared result type with a real exit code');
});

test('every new capability string has BOTH a non-empty EN and a non-empty AR value', () => {
  const i18n = readFileSync(join(ROOT, 'src', 'i18n.ts'), 'utf8');
  const keys = [
    'slash.cmd.diff.desc', 'slash.cmd.test.desc', 'slash.cmd.explain.desc',
    'slash.cmd.skills.desc', 'slash.cmd.mcp.desc', 'slash.cmd.budget.desc',
    'slash.diff.noRepo', 'slash.diff.bridge', 'slash.diff.clean', 'slash.diff.title',
    'slash.diff.allTitle', 'slash.diff.summary', 'slash.diff.failed',
    'slash.test.noWorkspace', 'slash.test.bridge', 'slash.test.noScript',
    'slash.test.running', 'slash.test.pass', 'slash.test.fail', 'slash.test.timeout', 'slash.test.error',
    'slash.explain.usage', 'slash.explain.bridge', 'slash.explain.reading', 'slash.explain.empty',
    'slash.explain.noProvider', 'slash.explain.failed', 'slash.explain.title',
    'slash.skills.status', 'slash.skills.on', 'slash.skills.off', 'slash.skills.listEmpty',
    'slash.skills.listTitle', 'slash.skills.bad', 'slash.skills.state.on', 'slash.skills.state.off',
    'slash.skills.state.ask',
    'slash.mcp.empty', 'slash.mcp.listTitle', 'slash.mcp.testUsage', 'slash.mcp.notFound',
    'slash.mcp.testing', 'slash.mcp.connected', 'slash.mcp.failed', 'slash.mcp.bad', 'slash.mcp.bridge',
    'slash.budget.title', 'slash.budget.tokens', 'slash.budget.cost', 'slash.budget.lastTurn',
    'slash.budget.taskCap', 'slash.budget.noCap', 'slash.budget.verification',
    'cap.panel.copy', 'cap.panel.copied', 'cap.panel.close', 'cap.panel.title', 'chat.stopping',
  ];
  for (const key of keys) {
    const re = new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*\\['[^']+',\\s*'[^']+']`);
    assert.match(i18n, re, `${key} has EN + AR strings on one line`);
  }
});
