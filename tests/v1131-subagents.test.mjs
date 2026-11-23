// ============================================================
// SADEEM v11.31 — SUBAGENT / TEAM capability audit (offline).
//   node --test --test-force-exit tests/v1131-subagents.test.mjs
//
// Real mock children (plain promises + AbortSignals, NO model/network) drive
// the esbuild-bundled engine modules: succeed / fail / hang / abort, honest
// timeout flags, orphan-free retry cancellation, no duplicate notices, no
// misattributed errors and a non-stale ledger. Both UI components are then
// SSR-rendered against the REAL React + zustand store (v11.16 posture), with
// special attention to buttons that used to be dead.
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1131-subagents-'));
const ud = join(tmp, 'ud');
mkdirSync(ud, { recursive: true });

// electron stub — capture every `kdx:subagents:event` pushed to the renderer.
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `const events = [];\nmodule.exports = {\n` +
    `  __events: events,\n` +
    `  app: { getPath: () => ${JSON.stringify(ud)} },\n` +
    `  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_ch, p) => events.push(p) } }] },\n` +
    `  ipcMain: { handle: () => {} },\n` +
    `};\n`,
);
const electron = require(join(stubDir, 'index.js'));
const busEvents = () => electron.__events.slice();
const clearBus = () => { electron.__events.length = 0; };
const flush = () => new Promise((resolve) => setImmediate(resolve));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bundle(entry, outfile, external = ['electron']) {
  esbuild.buildSync({
    entryPoints: [join(ROOT, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    external,
    logLevel: 'silent',
  });
}

const sa = require((() => {
  const p = join(tmp, 'subagents.cjs');
  bundle('electron/agent/subagents.ts', p);
  return p;
})());
const runner = require((() => {
  const p = join(tmp, 'subagentRunner.cjs');
  bundle('electron/agent/subagentRunner.ts', p);
  return p;
})());

const task = (id, label) => ({
  id,
  label,
  role: 'explore',
  description: `work for ${id}`,
  prompt: `Do ${id} work`,
});

// ------------------------------------------------------------
// 1 — REAL mock children through the batch host
// ------------------------------------------------------------

test('v1131 SUCCEED: parallel children merge in order with real progress and no notices', async () => {
  sa.clearSubagents();
  clearBus();
  let active = 0;
  let maxActive = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const emitted = [];
  const notices = [];

  const results = await runner.runSubagentBatch([task('ok-a', 'Ok A'), task('ok-b', 'Ok B')], {
    ledger: false,
    timeoutMs: 500,
    emit: (e) => emitted.push(e),
    notice: (n) => notices.push(n),
    runner: async (t, hooks) => {
      active++;
      maxActive = Math.max(maxActive, active);
      if (active === 2) release();
      await gate; // a sequential host would deadlock here
      hooks.progress(1, 2, `${t.id}:one`);
      hooks.progress(2, 2, `${t.id}:two`);
      return `${t.id}-result`;
    },
  });

  assert.equal(maxActive, 2, 'genuine overlap');
  assert.deepEqual(results.map((r) => r.id), ['ok-a', 'ok-b']);
  assert.ok(results.every((r) => r.ok && !r.timedOut && !r.aborted));
  assert.deepEqual(results.map((r) => r.result), ['ok-a-result', 'ok-b-result']);
  assert.equal(notices.length, 0, 'success is silent');
  assert.deepEqual(emitted.filter((e) => e.id === 'ok-a').map((e) => e.pct), [50, 100]);
});

test('v1131 FAIL: honest child error, healthy sibling survives, exactly one notice', async () => {
  sa.clearSubagents();
  clearBus();
  const notices = [];
  const results = await runner.runSubagentBatch([task('good', 'Good'), task('bad', 'Bad')], {
    ledger: true,
    timeoutMs: 500,
    notice: (n) => notices.push(n),
    runner: async (t) => {
      if (t.id === 'bad') throw new Error('child-only API error 422');
      return 'good-result';
    },
  });
  await flush();

  const good = results.find((r) => r.id === 'good');
  const bad = results.find((r) => r.id === 'bad');
  assert.equal(good.ok, true);
  assert.equal(good.result, 'good-result');
  assert.equal(good.error, undefined, 'no cross-contamination');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /child-only API error 422/);
  assert.equal(bad.timedOut, undefined, 'a fast failure is NOT a timeout');
  assert.equal(bad.aborted, undefined, 'a fast failure is NOT an abort');
  assert.equal(notices.filter((n) => n.subagentId === 'bad').length, 1);
  assert.equal(notices.filter((n) => n.subagentId === 'good').length, 0);
  assert.equal(busEvents().filter((e) => e.type === 'notice' && e.notice?.subagentId === 'bad').length, 1,
    'finalize owns the single canonical bus notice');
  assert.equal(sa.getSubagent('bad').status, 'error');
});

test('v1131 HANG: deadline stops the child (no orphan) and reports an honest timeout', async () => {
  sa.clearSubagents();
  clearBus();
  const seen = [];
  const t0 = Date.now();
  const results = await runner.runSubagentBatch([task('hung', 'Hung'), task('alive', 'Alive')], {
    ledger: false,
    timeoutMs: 60,
    runner: (t, hooks) => {
      seen.push({ id: t.id, hooks });
      if (t.id !== 'hung') return Promise.resolve('alive-result');
      return new Promise(() => { /* never settles */ });
    },
  });

  assert.ok(Date.now() - t0 < 600, 'batch returned promptly');
  const hung = results.find((r) => r.id === 'hung');
  assert.equal(hung.timedOut, true);
  assert.equal(hung.aborted, undefined, 'timeout is NOT mislabeled as abort');
  assert.match(hung.error, /timed out after 60ms/i);
  assert.equal(results.find((r) => r.id === 'alive').result, 'alive-result');
  assert.equal(seen.find((s) => s.id === 'hung').hooks.signal.aborted, true, 'hung child received abort');
});

test('v1131 ABORT: parent cancellation stops every child; ledger says aborted (not error)', async () => {
  sa.clearSubagents();
  clearBus();
  const notices = [];
  const children = [];
  const ac = new AbortController();
  const batch = runner.runSubagentBatch([task('ab-1', 'A1'), task('ab-2', 'A2')], {
    ledger: true,
    timeoutMs: 2000,
    signal: ac.signal,
    notice: (n) => notices.push(n),
    runner: (t, hooks) => {
      let stopped = false;
      hooks.signal.addEventListener('abort', () => { stopped = true; });
      children.push({ id: t.id, stopped: () => stopped });
      return new Promise((resolve) => {
        if (hooks.signal.aborted) return resolve('stopped');
        hooks.signal.addEventListener('abort', () => resolve('stopped'), { once: true });
      });
    },
  });
  await delay(20);
  ac.abort();
  const results = await batch;
  await flush();

  assert.equal(children.length, 2);
  for (const r of results) {
    assert.equal(r.ok, false);
    assert.equal(r.aborted, true);
    assert.equal(r.timedOut, undefined);
    assert.match(r.error, /aborted by the parent/i);
    assert.ok(children.find((c) => c.id === r.id).stopped(), 'child observed abort — no orphan');
    const rec = sa.getSubagent(r.id);
    assert.equal(rec.status, 'aborted', 'ledger status is aborted, not error');
  }
  for (const id of ['ab-1', 'ab-2']) {
    assert.equal(notices.filter((n) => n.subagentId === id).length, 1);
    const bus = busEvents().filter((e) => e.type === 'notice' && e.notice?.subagentId === id);
    assert.equal(bus.length, 1, 'no duplicate bus notice');
    assert.equal(bus[0].notice.kind, 'warn', 'a deliberate abort is a warning, not a child error');
    assert.doesNotMatch(bus[0].notice.text, /retry/i, 'no misleading retry hint on a cancelled child');
  }
});

// ------------------------------------------------------------
// 2 — the specific v11.31 regressions
// ------------------------------------------------------------

test('v1131 TIMEOUT FLAG: a child-owned timeout rejection is not reported as a generic failure', async () => {
  sa.clearSubagents();
  clearBus();
  const notices = [];
  const results = await runner.runSubagentBatch([task('own-timer', 'Own Timer')], {
    ledger: true,
    timeoutMs: 5000, // the BATCH deadline did NOT fire
    notice: (n) => notices.push(n),
    runner: async () => { throw new Error('detached runner own timer timed out after 5ms'); },
  });
  await flush();

  assert.equal(results[0].ok, false);
  assert.equal(results[0].timedOut, true, 'honest timeout flag on the result');
  assert.match(results[0].error, /timed out/i);
  assert.equal(sa.getSubagent('own-timer').timedOut, true, 'ledger carries the same honest flag');
  assert.match(notices[0].text, /timed out/i);
  assert.match(notices[0].text, /retry/i);
});

test('v1131 CONSUMER ERROR: throwing notice/emit hooks never become the child\'s error', async () => {
  sa.clearSubagents();
  clearBus();
  const results = await runner.runSubagentBatch([task('guarded', 'Guarded')], {
    ledger: false,
    timeoutMs: 500,
    emit: () => { throw new Error('renderer listener exploded'); },
    notice: () => { throw new Error('notice listener exploded'); },
    runner: async (_t, hooks) => { hooks.progress(1, 1, 'step'); return 'child-ok'; },
  });
  assert.equal(results[0].ok, true);
  assert.equal(results[0].result, 'child-ok');
  assert.equal(results[0].error, undefined);
});

test('v1131 RETRY ORPHAN: the guard deadline aborts the child, emits ONE notice, and a late result cannot revive the ledger row', async () => {
  sa.clearSubagents();
  clearBus();
  const prevGuard = process.env.SURNIA_SUBAGENT_RETRY_GUARD_MS;
  process.env.SURNIA_SUBAGENT_RETRY_GUARD_MS = '50';
  let hooksSeen = null;
  let resolveLate;
  sa.setSubagentRetryLauncher((_rec, hooks) => {
    hooksSeen = hooks;
    return new Promise((resolve) => { resolveLate = () => resolve('late-result'); });
  });
  try {
    const original = sa.startSubagent({
      label: 'Retry me', role: 'explore', description: 'retry work', prompt: 'retry prompt',
      workspace: join(tmp, 'ws'), sessionId: 's-retry', total: 4,
    });
    await flush();
    const launched = sa.retrySubagent(original.id);
    assert.equal(launched.ok, true);
    await delay(130);

    assert.ok(hooksSeen, 'launcher was invoked');
    assert.equal(hooksSeen.signal.aborted, true, 'child received abort at the deadline — no orphan');
    const row = sa.getSubagent(launched.id);
    assert.equal(row.status, 'error');
    assert.equal(row.timedOut, true, 'retry timeout flag is honest');
    const notices = busEvents().filter((e) => e.type === 'notice' && e.notice?.subagentId === launched.id);
    assert.equal(notices.length, 1, 'exactly one notice');
    assert.match(notices[0].notice.text, /timeout/i);

    resolveLate();
    await delay(40);
    assert.equal(sa.getSubagent(launched.id).status, 'error', 'late success did not overwrite the timeout (no stale ledger)');
    assert.equal(busEvents().filter((e) => e.type === 'notice' && e.notice?.subagentId === launched.id).length, 1,
      'no duplicate notice after the late settle');
  } finally {
    sa.setSubagentRetryLauncher(null);
    if (prevGuard === undefined) delete process.env.SURNIA_SUBAGENT_RETRY_GUARD_MS;
    else process.env.SURNIA_SUBAGENT_RETRY_GUARD_MS = prevGuard;
  }
});

test('v1131 SOURCE: runner and ledger carry the v11.31 guards', () => {
  const r = src('electron/agent/subagentRunner.ts');
  const s = src('electron/agent/subagents.ts');
  assert.match(r, /signal: ac\.signal/, 'tool context gets the cancellable child signal (no orphan process)');
  assert.match(r, /isSubagentTimeoutMessage\(raw\)/, 'child timeout is classified honestly');
  assert.match(r, /try \{\s*hooks\.notice\?\.\(/, 'standalone notice consumer is guarded');
  assert.match(r, /try \{\s*hooks\.progress\(done, total, step\)/, 'standalone progress consumer is guarded');
  assert.match(s, /export function isSubagentTimeoutMessage/, 'single shared timeout classifier');
  assert.match(s, /signal: controller\.signal/, 'retry launcher receives a cancellable signal');
  assert.match(s, /\(\) => failOnce\(`retry of \$\{fresh\.label\} timed out/, 'deadline finalizes once and aborts the child');
  assert.match(s, /kind: aborted \? 'warn' : 'error'/, 'abort notice is a warning, not a child error');
  assert.match(s, /timeoutMs: original\.timeoutMs/, 'retry carries the original wall-clock budget');
});

// ------------------------------------------------------------
// 3 — SSR of BOTH UI components (real React + store)
// ------------------------------------------------------------

// The SSR bundle must live INSIDE the project so its external `react` /
// `react-dom` requires resolve to the same project instance as react-dom/server.
const SSR_BUNDLE = join(ROOT, 'tests', '.v1131-ui.bundle.cjs');
let React;
let renderToStaticMarkup;
let ui;

before(() => {
  globalThis.window = {
    surnia: new Proxy({}, {
      get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => Promise.resolve(undefined)),
    }),
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false }),
    setTimeout: () => 1,
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  // Node 22 exposes a read-only global `navigator`; leave it alone.
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  esbuild.buildSync({
    stdin: {
      contents:
        "export { AgentTeamCard } from './src/components/AgentTeamCard';" +
        "export { SubagentDetailModal } from './src/components/SubagentDetailModal';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: SSR_BUNDLE,
    loader: { '.css': 'empty' },
    external: ['electron', 'react', 'react-dom', 'lucide-react'],
    logLevel: 'silent',
  });
  ui = require(SSR_BUNDLE);
  React = require('react');
  // SSR has no getServerSnapshot; observe the live (seeded) store state.
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

const h = (...args) => React.createElement(...args);
const render = (Comp, props = {}) => renderToStaticMarkup(h(Comp, props));

const record = (id, extra = {}) => ({
  id,
  label: `Agent ${id}`,
  role: 'explore',
  description: `desc ${id}`,
  prompt: `prompt ${id}`,
  status: 'done',
  done: 4,
  total: 4,
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_001_000,
  durationMs: 1000,
  workspace: '/w',
  sessionId: 's',
  background: false,
  attempt: 0,
  ...extra,
});

const chatTask = (id, prompt, description) => ({
  id,
  toolCallId: `tc-${id}`,
  content: JSON.stringify({ agent: 'explore', description, prompt }),
});

test('v1131 SSR AgentTeamCard: renders the orbit, real statuses and clickable nodes', () => {
  ui.useStore.setState({
    subagents: [
      record('r1'),
      record('r2', { status: 'running', done: 2, prompt: 'verbatim-promise' }),
    ],
  });
  const tasks = [
    chatTask('m1', 'verbatim-promise', 'desc r2'),
    // No exact prompt AND a paraphrased description: the OLD join left this
    // chip permanently disabled (a dead button). The role/running fallback
    // must still resolve a ledger id.
    chatTask('m2', 'a paraphrased prompt', 'a paraphrased description'),
  ];
  const html = render(ui.AgentTeamCard, { tasks, resultById: new Map() });

  assert.match(html, /agt-card/);
  assert.match(html, /data-agents="2"/);
  assert.match(html, /AGENT TEAM/);
  assert.match(html, /data-status="done"/);
  assert.match(html, /data-status="running"/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="75"/, 'overall = (100 + 50) / 2');
  const nodes = html.match(/<button[^>]*class="agt-node[^"]*"[^>]*>/g) || [];
  assert.equal(nodes.length, 2, 'one node button per task');
  for (const node of nodes) {
    assert.match(node, /data-record-id="r[12]"/, 'node resolved to a ledger row');
    assert.doesNotMatch(node, /\sdisabled/, 'the detail button is NOT dead');
  }
});

test('v1131 SSR AgentTeamCard: empty ledger keeps nodes honestly disabled (no false join)', () => {
  ui.useStore.setState({ subagents: [] });
  const html = render(ui.AgentTeamCard, {
    tasks: [chatTask('m1', 'x', 'y'), chatTask('m2', 'a', 'b')],
    resultById: new Map(),
  });
  const nodes = html.match(/<button[^>]*class="agt-node[^"]*"[^>]*>/g) || [];
  assert.equal(nodes.length, 2);
  assert.ok(nodes.every((n) => /\sdisabled/.test(n)), 'no ledger row → no detail navigation');
  assert.ok(nodes.every((n) => !/data-record-id="/.test(n)));
});

test('v1131 SSR SubagentDetailModal: dialog, prompt, timeline and a LIVE retry button', () => {
  ui.useStore.setState({
    subagents: [
      record('d1', {
        status: 'error',
        error: 'boom: provider 422',
        prompt: 'do the real thing',
        description: 'the real thing',
      }),
    ],
    subagentDetailId: 'd1',
    subagentSteps: {
      d1: [
        { at: 1_700_000_000_100, done: 1, total: 4 },
        { at: 1_700_000_000_200, done: 2, total: 4 },
      ],
    },
  });
  const html = render(ui.SubagentDetailModal);

  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /SUBAGENT \/ DETAIL/);
  assert.match(html, /do the real thing/, 'full prompt is shown');
  assert.match(html, /boom: provider 422/, 'honest error is shown');
  assert.match(html, /Step 1 of 4/);
  assert.match(html, /Step 2 of 4/);
  assert.match(html, /data-testid="sad-retry"/);
  assert.match(html, /aria-busy="false"/);
  const retry = html.match(/<button[^>]*data-testid="sad-retry"[^>]*>/)?.[0] || '';
  assert.ok(retry, 'retry button is present');
  assert.doesNotMatch(retry, /\sdisabled/, 'retry button is NOT dead');
  assert.match(html, /Retry/, 'retry label rendered');
});

test('v1131 SSR SubagentDetailModal: no id → nothing; unknown id → empty state and disabled retry', () => {
  ui.useStore.setState({ subagents: [], subagentDetailId: null, subagentSteps: {} });
  assert.equal(render(ui.SubagentDetailModal), '', 'closed modal renders nothing');

  ui.useStore.setState({ subagentDetailId: 'missing', subagents: [], subagentSteps: {} });
  const html = render(ui.SubagentDetailModal);
  assert.match(html, /no longer in the ledger/);
  const retry = html.match(/<button[^>]*data-testid="sad-retry"[^>]*>/)?.[0] || '';
  assert.match(retry, /\sdisabled/, 'no record → retry is honestly disabled');
});

test('v1131 SOURCE: both UI files keep the dead-button guards', () => {
  const card = src('src/components/AgentTeamCard.tsx');
  const modal = src('src/components/SubagentDetailModal.tsx');
  assert.match(card, /function matchLedgerRecord/, 'role/running fallback keeps chip nodes clickable');
  assert.match(card, /openSubagentDetail\?\.\(m\.recordId\)/, 'missing store action cannot throw on click');
  assert.match(modal, /const text = record\?\.prompt \|\| record\?\.description \|\| ''/, 'copy works on legacy rows');
  assert.match(modal, /const onRetry = \(\) =>/, 'retry has a real handler');
  assert.match(modal, /retrySubagent\?\.\(record\.id\)/, 'retry guards a missing store action');
  assert.match(modal, /aria-busy=\{retrying\}/, 'retry exposes a busy state instead of looking dead');
});

after(() => {
  try { sa.setSubagentRetryLauncher(null); } catch { /* best-effort */ }
  try { unlinkSync(SSR_BUNDLE); } catch { /* already gone */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
