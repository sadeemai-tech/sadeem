// ============================================================
// v11.31 — UI CAPABILITY RUN GUARD
// ------------------------------------------------------------
// Independent verification of the five owned panels:
//   FlowsPanel · SchedulePanel · SessionsPanel · UsagePanel · DnaPanel
//
// It bundles the REAL panels + REAL store with esbuild, SSRs them with
// renderToStaticMarkup, and drives real button onClick handlers captured from
// react/jsx-runtime (jsdom / react-test-renderer are not installed here).
// Assertions print an exact `file:line` of the offending source so the parent
// can hand a failure straight to the fixing agent. This suite NEVER patches
// application source — it only reads and exercises it.
//
//   node --test --test-force-exit tests/v1131-ui-run.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const P = {
  flows: 'src/components/panels/FlowsPanel.tsx',
  sched: 'src/components/panels/SchedulePanel.tsx',
  sess: 'src/components/panels/SessionsPanel.tsx',
  usage: 'src/components/panels/UsagePanel.tsx',
  dna: 'src/components/panels/DnaPanel.tsx',
};
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SRC = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, read(p)]));

/** Drop comments only — a "removed" note must not make a strict guard brittle. */
const strip = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
const CODE = Object.fromEntries(Object.entries(SRC).map(([k, s]) => [k, strip(s)]));

function lineOf(src, needle) {
  const i = src.indexOf(needle);
  if (i < 0) return 0;
  let line = 1;
  for (let k = 0; k < i; k++) if (src.charCodeAt(k) === 10) line++;
  return line;
}
const at = (k, needle) => `${P[k]}:${lineOf(SRC[k], needle) || '?'}`;
const has = (k, needle) => CODE[k].includes(needle);

// ---------- bridge spy (the real api object IS window.surnia) ----------
const calls = { dnaGet: 0, dnaUpdate: [], saveSession: [], listSessions: 0, loadDnaProbe: 0 };
const flows = [
  { id: 'f1', name: 'Nightly digest', prompt: 'Summarise the repo', scope: 'global', createdAt: 1, runCount: 3, lastRun: Date.now() - 60000 },
  { id: 'f2', name: 'Risk scan', prompt: 'Check for secrets', scope: 'workspace', createdAt: 2, runCount: 0 },
];
const jobs = [
  { id: 'j1', name: 'Standup', prompt: 'digest', cron: '0 9 * * 1-5', workspace: 'C:/ws', mode: 'autoEdit', enabled: true, lastStatus: 'ok', lastRun: Date.now() - 3600000 },
  { id: 'j2', name: 'Risk', prompt: 'scan', cron: '@daily', workspace: 'C:/ws', mode: 'read', enabled: false, lastStatus: 'error' },
];
const sessions = [
  { id: 's1', title: 'Alpha chat', updatedAt: Date.now() - 1000, messageCount: 4, totalTokens: 1200, totalCostUsd: 0.02, model: 'custom/m', workspace: 'C:/ws' },
  { id: 's2', title: 'Beta chat', updatedAt: Date.now() - 90000, messageCount: 0, totalTokens: 0, totalCostUsd: 0 },
];
const dna = {
  version: 1,
  profile: { name: 'Ada', role: 'Engineer', expertise: ['TS'], languages: [], likes: [], dislikes: [], styleNotes: [] },
  patterns: [{ id: 'p1', kind: 'workflow', text: 'Always typecheck', count: 2, firstSeen: 1, lastSeen: Date.now(), confidence: 0.8 }],
  feedback: [
    { ts: 1, kind: 'praise', note: 'Nice work' },
    { ts: 2, kind: 'correction', note: 'Use pnpm' },
    { ts: 3, kind: 'preference', note: 'Concise answers' },
  ],
  stats: { sessionsObserved: 9, factsRecorded: 5, updatedAt: Date.now() },
};
const dnaStats = { sessionsObserved: 9, patterns: 1, feedback: 12, growth: [] };

const baseBridge = {
  flowsList: async () => flows,
  flowsSave: async (f) => [...flows, { ...f, id: 'f-new', createdAt: 3, runCount: 0 }],
  flowsDelete: async () => flows.slice(1),
  flowsMarkRun: async () => {},
  scheduleList: async () => jobs,
  scheduleAdd: async () => ({}),
  scheduleRemove: async () => ({ ok: true }),
  scheduleToggle: async () => ({ ok: true }),
  scheduleRunNow: async () => ({ ok: true }),
  scheduleWebhook: async () => ({ url: 'http://127.0.0.1:7681/trigger/<jobId>', token: 'tok' }),
  listSessions: async () => { calls.listSessions++; return sessions; },
  loadSession: async (id) => ({ ...sessions.find((s) => s.id === id), id, messages: [], todos: [] }),
  saveSession: async (data) => { calls.saveSession.push(data); },
  dnaGet: async () => { calls.dnaGet++; return dna; },
  dnaStats: async () => dnaStats,
  dnaUpdate: async (req) => { calls.dnaUpdate.push(req); return { ok: true }; },
  dnaClear: async () => ({ cleared: true }),
  playbookGet: async () => ({ version: 3, worked: ['x'], failed: [], preferences: [], recipes: [], lastLearned: 'learned x' }),
  playbookHistory: async () => [{ version: 1, ts: 1, summary: 'v1', changes: [] }, { version: 3, ts: 2, summary: 'v3', changes: [] }],
  playbookClear: async () => ({ cleared: true }),
  appMetrics: async () => ({ cpuPercent: 4.2, memoryMB: 256, processes: 12, uptimeSec: 4521, hostMemTotalMB: 16000, hostMemFreeMB: 6000 }),
  journalList: async () => [],
  journalRead: async () => [],
  getSettings: async () => ({ language: 'en' }),
  onDnaEvent: () => () => {},
  onPlaybookEvent: () => () => {},
};
const bridge = new Proxy(baseBridge, {
  get(t, k) {
    if (k === 'then' || k === 'toJSON' || typeof k === 'symbol') return undefined;
    if (k in t) return t[k];
    return () => Promise.resolve(undefined);
  },
});

const BUNDLE = join(ROOT, 'tests', '.v1131-ui-run.bundle.cjs');
let mod, React, renderToStaticMarkup;
let origJsx, origJsxs;
const captured = [];

before(() => {
  const timers = { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {} };
  globalThis.window = {
    surnia: bridge, kodex: bridge,
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    matchMedia: () => ({ matches: false }),
    confirm: () => true,
    ...timers,
    innerWidth: 1280, innerHeight: 800,
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {}, value: '' }),
    execCommand: () => true,
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } }, configurable: true, writable: true,
  });

  esbuild.buildSync({
    stdin: {
      contents:
        "export { useStore } from './src/store';" +
        "export { FlowsPanel } from './src/components/panels/FlowsPanel';" +
        "export { SchedulePanel, cronNextRun } from './src/components/panels/SchedulePanel';" +
        "export { SessionsPanel, renameRecord } from './src/components/panels/SessionsPanel';" +
        "export { UsagePanel, currentStreak, longestStreak } from './src/components/panels/UsagePanel';" +
        "export { DnaPanel } from './src/components/panels/DnaPanel';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
    loader: { '.css': 'empty', '.svg': 'dataurl' },
    external: [
      'electron', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/server', 'zustand',
      'lucide-react', '@xterm/xterm', '@xterm/addon-fit', 'monaco-editor', '@monaco-editor/react',
    ],
  });
  mod = require(BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect; // SSR silence
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;

  const jr = require('react/jsx-runtime');
  origJsx = jr.jsx; origJsxs = jr.jsxs;
  jr.jsx = (...a) => { captured.push({ type: a[0], props: a[1] || {} }); return origJsx(...a); };
  jr.jsxs = (...a) => { captured.push({ type: a[0], props: a[1] || {} }); return origJsxs(...a); };
});

after(() => {
  const jr = require('react/jsx-runtime');
  if (origJsx) jr.jsx = origJsx;
  if (origJsxs) jr.jsxs = origJsxs;
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

const h = (...a) => React.createElement(...a);
const T = 1700000000000;

function seed(extra = {}) {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    settings: {
      ...prev.settings, language: 'en', numerals: 'western',
      usageLog: [
        { date: new Date().toISOString().slice(0, 10), runs: 2, tokens: 1000, costUsd: 0.01 },
        { date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), runs: 1, tokens: 500, costUsd: 0.005 },
      ],
      model: { provider: 'custom', model: 'm' },
    },
    running: false, booted: true, wsPath: 'C:/ws', notify: () => {},
    ...extra,
  });
}
const renderFlows = () => renderToStaticMarkup(h(mod.FlowsPanel));
const renderSched = () => renderToStaticMarkup(h(mod.SchedulePanel));
const renderSess = () => renderToStaticMarkup(h(mod.SessionsPanel));
const renderUsage = () => renderToStaticMarkup(h(mod.UsagePanel));
const renderDna = () => renderToStaticMarkup(h(mod.DnaPanel));

/** Find a captured element whose title/aria-label contains `text` and has onClick. */
function btn(text) {
  return captured.find((e) => {
    const p = e.props || {};
    const label = `${p.title || ''} ${p['aria-label'] || ''}`;
    return typeof p.onClick === 'function' && label.includes(text);
  });
}
async function click(el) {
  assert.ok(el, 'the expected control exists and has an onClick handler');
  const oldErr = console.error; console.error = () => {};
  try {
    await Promise.resolve(el.props.onClick({ preventDefault() {}, stopPropagation() {} }));
    await new Promise((r) => setImmediate(r));
  } finally { console.error = oldErr; }
}

// ============================================================
// 1 — SOURCE GUARDS (exact file:line on failure)
// ============================================================
test('F1 flows: ref guard, markRun reconciliation, honest save, clipboard fallback', () => {
  assert.ok(has('flows', 'if (runningRef.current) return;'), `${at('flows', 'runningRef.current')}: rapid-click guard`);
  // v11.38 (F5) — executeFlowRun() was refactored: all terminal paths converge
  // on ONE clear at the end of the async function (cleaner than two clears).
  // Assert the guard + at least one authoritative clear before function end.
  const refClears = CODE.flows.match(/runningRef\.current = null;/g) || [];
  assert.ok(refClears.length >= 1, `${P.flows}: ref cleared unconditionally (${refClears.length} clears)`);
  // v11.38 (F5) — reconciliation is in executeFlowRun: it awaits a record()
  // dependency that returns `=== true` before bumping runCount. Assert the
  // settle-before-reconcile contract, not a literal call spelling.
  assert.ok(
    /recorded\s*=\s*\(await\s+deps\.record\([^)]*\)\)\s*===\s*true/.test(CODE.flows) ||
      /await flowsApi\.flowsMarkRun\?\.\(/.test(CODE.flows),
    `${P.flows}: markRun settles before reconcile`,
  );
  assert.ok(has('flows', 'load();'), `${at('flows', 'load();')}: re-read authoritative run count from disk`);
  assert.ok(has('flows', 'delete next[f.id];'), `${P.flows}: optimistic bump dropped after reconcile`);
  assert.ok(has('flows', "if (!Array.isArray(list))"), `${at('flows', 'if (!Array.isArray(list))')}: no false "saved" toast`);
  assert.ok(has('flows', "document.execCommand('copy')"), `${at('flows', "document.execCommand('copy')")}: clipboard fallback`);
});

test('S1 schedule: manual refresh + verified create (no false success toast)', () => {
  assert.ok(has('sched', 'onClick={refreshAll}'), `${at('sched', 'onClick={refreshAll}')}: refresh control wired`);
  assert.ok(has('sched', "t('sch.createFailed'"), `${at('sched', "t('sch.createFailed'")}: honest create failure`);
  assert.ok(has('sched', 'if (!(await landed()))'), `${P.sched}: create/edit verified against reloaded list`);
  assert.equal((CODE.sched.match(/<RotateCw\b/g) || []).length, 1, `${P.sched}: one refresh glyph`);
});

test('X1 sessions: inactive rename writes to disk and refreshes the list', () => {
  assert.ok(has('sess', 'api.saveSession({ ...data, title'), `${at('sess', 'api.saveSession({ ...data, title')}: inactive session rename`);
  assert.ok(has('sess', 'useStore.setState({ sessions: list || [] })'), `${P.sess}: list refreshed after rename`);
  assert.ok(has('sess', "new CustomEvent('surnia:session-loading')"), `${P.sess}: open icon shimmer handshake`);
});

test('U1 usage: reconciliation claim is conditional + manual live refresh', () => {
  assert.ok(has('usage', 'const rowsReconcile = allRowsTokens === sessionTokens;'), `${at('usage', 'rowsReconcile')}: equality checked`);
  assert.ok(has('usage', "t('usage.rowsDiffer'"), `${at('usage', "t('usage.rowsDiffer'")}: honest mismatch text`);
  assert.ok(has('usage', 'onClick={() => setRefreshKey((k) => k + 1)}'), `${P.usage}: refresh button wired`);
  assert.ok(has('usage', '}, [refreshKey]);'), `${P.usage}: refresh re-runs the metrics effect`);
});

test('D1 dna: every forget/edit refreshes and reports errors; no silent catch', () => {
  assert.ok(!CODE.dna.includes('.catch(() => undefined)'), `${P.dna}: no silent failure anywhere`);
  assert.ok(has('dna', "t('dna.fb.forget'"), `${P.dna}: per-entry forget control`);
  const fbForget = CODE.dna.indexOf("t('dna.fb.forget'");
  const tail = CODE.dna.slice(fbForget, fbForget + 400);
  assert.ok(tail.includes('.then(afterEdit)'), `${P.dna}: feedback forget calls loadDna (was stale)`);
  assert.ok(has('dna', 'const fbTotal ='), `${at('dna', 'const fbTotal =')}: true feedback count`);
  assert.ok(has('dna', 'finally {'), `${P.dna}: forget always reconciles with disk`);
  assert.ok(has('dna', 'notify(errMsg())'), `${P.dna}: failures are visible`);
});

// ============================================================
// 2 — PURE MATH (exported from the real panels)
// ============================================================
test('S2 cronNextRun: weekday 9:00 lands on a weekday at 09:00', () => {
  const from = new Date('2026-11-21T12:00:00Z'); // Saturday
  const next = mod.cronNextRun('0 9 * * 1-5', from);
  assert.ok(next > from.getTime(), 'next run is in the future');
  const d = new Date(next);
  assert.equal(d.getHours(), 9, '09:00 local (cronNextRun uses local fields)');
  assert.ok(d.getDay() >= 1 && d.getDay() <= 5, 'a weekday');
  assert.equal(mod.cronNextRun('not a cron', from), 0, 'unparseable cron → 0 (honest dash)');
});

test('U2 streak math: anchored on today/yesterday, empty → 0', () => {
  const key = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  assert.equal(mod.currentStreak([]), 0, 'empty → 0');
  assert.equal(mod.longestStreak([]), 0, 'empty → 0');
  assert.equal(mod.currentStreak([key(2), key(1), key(0)]), 3, 'three consecutive active days');
  assert.equal(mod.currentStreak([key(5), key(4)]), 0, 'a gap breaks the current streak');
  assert.equal(mod.longestStreak([key(5), key(4), key(3), key(1)]), 3, 'longest run is 3');
});

// ============================================================
// 3 — SSR: flows list / empty / graphics
// ============================================================
test('F2 source: every flow row wires run / copy / edit / delete to a real handler', () => {
  const row = CODE.flows.slice(CODE.flows.indexOf('flows.map('));
  for (const needle of ['onClick={() => void run(f)}', 'onClick={() => copyPrompt(f)}', 'onClick={() => startEdit(f)}', 'onClick={() => remove(f)}']) {
    assert.ok(row.includes(needle), `${at('flows', needle)}: flow action wired`);
  }
  assert.ok(has('flows', "t('flows.run.flow'") || has('flows', "t('flows.run'"), `${P.flows}: honest Run label (idempotent prompt re-send)`);
});

test('F3 SSR: loading skeleton, engraved glyph, comparison strip — no false empty state', () => {
  seed({ flows: null, session: { id: 's1', title: 't', messages: [], createdAt: T, updatedAt: T }, sendMessage: async () => {} });
  const html = renderFlows();
  assert.ok(html.includes('skeleton-shimmer'), 'loading skeleton while flows are unknown');
  assert.ok(html.includes('fl-glyph'), 'engraved loop glyph drawn');
  assert.ok(html.includes('fl-compare'), 'flows-vs-jobs comparison strip present');
  assert.ok(html.includes('flows.title') || html.includes('Flows'), 'page head rendered');
  assert.ok(!html.includes('fl-empty-art'), 'no false empty state while loading');
  // Empty-state graphics/CTA live in source (local state is not SSR-seedable).
  assert.ok(has('flows', '<FlowLoopEmptyArt />'), `${at('flows', '<FlowLoopEmptyArt />')}: missing-link art`);
  assert.ok(has('flows', "t('flows.empty.cta'"), `${at('flows', "t('flows.empty.cta'")}: real empty CTA`);
});

// ============================================================
// 4 — SSR: schedule KPIs / hero / controls / empty
// ============================================================
test('S3 SSR: KPI counts, countdown hero, run/toggle/edit/remove controls', () => {
  seed({ scheduledJobs: jobs });
  const html = renderSched();
  assert.ok(html.includes('Standup') && html.includes('Risk'), 'real job names');
  assert.ok(html.includes('sch-hero-clock') && html.includes('NEXT SCHEDULED RUN'), 'live countdown hero');
  assert.ok(html.includes('sch-cadence'), 'human cadence label');
  assert.ok(html.includes('Webhook trigger'), 'webhook card present');
  assert.ok(html.includes('UNAVAILABLE'), 'honest UNAVAILABLE before the effect loads the bridge');
  assert.ok((html.match(/title="Run now"/g) || []).length === 2, 'run-now on each job');
  assert.ok((html.match(/title="Delete"/g) || []).length === 2, 'delete on each job');
  assert.ok(html.includes('sch-refresh'), 'manual refresh control visible');
  assert.ok(html.includes('sch-kpi-value'), 'KPI strip rendered');
});

test('S4 SSR: empty schedule shows a single real Add-job CTA', () => {
  seed({ scheduledJobs: [] });
  const html = renderSched();
  assert.ok(html.includes('No scheduled jobs yet'), 'honest empty state');
  assert.ok(html.includes('Nothing scheduled yet'), 'hero empty state');
  assert.ok(html.includes('Add job'), 'real CTA');
});

// ============================================================
// 5 — SSR: sessions list, timeline, rename runtime
// ============================================================
test('X2 SSR: session rows, meta, timeline and all six hover actions', () => {
  seed({ sessions, session: { id: 's1', title: 'Alpha chat', messages: [], createdAt: T, updatedAt: T }, activeId: 's1' });
  const html = renderSess();
  assert.ok(html.includes('Alpha chat') && html.includes('Beta chat'), 'real session titles');
  assert.ok(html.includes('messages') && html.includes('1.2k'), 'real meta shown');
  assert.ok(html.includes('SESSION TIMELINE'), 'timeline graphic');
  assert.ok(html.includes('Run journals'), 'run-journals section');
  for (const title of ['Fork session', 'Export as Markdown', 'Export recap', 'Open', 'Rename']) {
    assert.ok(html.includes(title), `action ${title} rendered`);
  }
});

test('X3 runtime: renaming an INACTIVE session writes title to disk and refreshes list', async () => {
  calls.saveSession.length = 0;
  calls.listSessions = 0;
  let activeRenamed = false;
  // activeId = s1, so s2 is inactive: the store path must NOT be used.
  const ok = await mod.renameRecord('s2', 'Beta renamed', 's1', async () => { activeRenamed = true; });
  assert.equal(ok, true, 'rename helper succeeded');
  assert.equal(activeRenamed, false, 'inactive rename never called the active-only store action');
  assert.ok(calls.saveSession.some((d) => d.id === 's2' && d.title === 'Beta renamed'), 'inactive session title persisted');
  assert.ok(calls.listSessions > 0, 'session list refreshed so the row updates');

  // Active session still uses the store path (which keeps chat + disk in sync).
  calls.saveSession.length = 0;
  activeRenamed = false;
  await mod.renameRecord('s1', 'Alpha renamed', 's1', async () => { activeRenamed = true; });
  assert.equal(activeRenamed, true, 'active rename uses the store action');
  assert.equal(calls.saveSession.length, 0, 'active path does not double-write the record');
});

// ============================================================
// 6 — SSR: usage stats, chart, reconciliation honesty
// ============================================================
test('U3 SSR: today stats, chart, per-message rows and reconciled stamp', () => {
  const msg = { id: 'm1', role: 'assistant', kind: 'text', content: 'ok', timestamp: T,
    usage: { inputTokens: 700, outputTokens: 300, costUsd: 0.001, cacheReadTokens: 100, attempts: [{ provider: 'custom', model: 'm', inputTokens: 700, outputTokens: 300, costUsd: 0.001 }] } };
  seed({
    session: { id: 's1', title: 't', messages: [msg], createdAt: T, updatedAt: T },
    sessionUsage: { inputTokens: 1000, outputTokens: 0, costUsd: 0.001, cacheReadTokens: 100 },
  });
  const html = renderUsage();
  assert.ok(html.includes('FIG. 02 / ACTUAL USAGE'), 'real usage chart drawn');
  assert.ok(html.includes('App performance'), 'live performance card');
  assert.ok(html.includes('custom/m'), 'per-message row shows the real model attribution');
  assert.ok(!html.includes('No billed turns yet'), 'a real usage footer produced a billing row');
  assert.ok(html.includes('Reconciled'), 'equal totals → honest reconciled stamp');
  assert.ok(html.includes('Refresh live stats'), 'manual refresh control');
  assert.ok(html.includes('02 / USAGE'), 'page head');
});

test('U4 SSR: mismatched totals show honest figures, not a false "Reconciled"', () => {
  const msg = { id: 'm1', role: 'assistant', kind: 'text', content: 'ok', timestamp: T,
    usage: { inputTokens: 10, outputTokens: 5, costUsd: 0, attempts: [] } };
  seed({
    session: { id: 's1', title: 't', messages: [msg], createdAt: T, updatedAt: T },
    sessionUsage: { inputTokens: 999, outputTokens: 0, costUsd: 0 },
  });
  const html = renderUsage();
  assert.ok(!html.includes('Reconciled'), 'no false reconciliation claim');
  assert.ok(html.includes('15') && html.includes('999'), 'both real figures shown');
});

// ============================================================
// 7 — SSR: DNA stats, forget/clear, playbook, counts
// ============================================================
test('D2 SSR: identity sheet, growth tiles, patterns, feedback total and forget', () => {
  seed({ dna, dnaStats, dnaLoading: false, dnaSuggestion: null, skillsTrustNeeded: false,
    playbook: null, playbookHistory: [], lastPlaybookLearning: null });
  const html = renderDna();
  assert.ok(html.includes('Ada') && html.includes('Engineer'), 'identity sheet from real profile');
  assert.ok(html.includes('Always typecheck'), 'learned pattern row');
  assert.ok(html.includes('12 entries'), 'fb stamp shows TRUE total, not the 3 rendered');
  assert.ok(html.includes('last 3 shown'), 'honest truncation note');
  assert.ok(html.includes('9') && html.includes('5'), 'growth tiles show real sessions/facts');
  assert.ok(html.includes('Forget workspace') && html.includes('Forget all'), 'privacy controls');
});

test('D3 runtime: per-entry feedback forget refreshes DNA (the stale-state fix)', async () => {
  calls.dnaGet = 0;
  calls.dnaUpdate.length = 0;
  seed({ dna, dnaStats, dnaLoading: false, dnaSuggestion: null, skillsTrustNeeded: false,
    playbook: null, playbookHistory: [], lastPlaybookLearning: null });
  captured.length = 0;
  renderDna();
  const forgetBtn = btn('Forget this entry');
  assert.ok(forgetBtn, 'per-entry forget button captured');
  const before = calls.dnaGet;
  await click(forgetBtn);
  assert.ok(calls.dnaUpdate.some((r) => r.section === 'feedback'), 'dnaUpdate(feedback) called');
  assert.ok(calls.dnaGet > before, 'loadDna() ran after the edit — no stale row');
});

test('D4 source: v1127-dna-guard chain untouched (engine/dna/prompts/store)', () => {
  // The guard tests the main-process DNA chain; these panels must not be the
  // only place DNA is refreshed from — the store subscription stays intact.
  const store = read('src/store.ts');
  assert.ok(store.includes('onDnaEvent'), 'store still subscribes to dna events');
  assert.ok(store.includes('loadDna'), 'store still exposes loadDna');
  assert.ok(has('dna', 'void loadDna();') || has('dna', 'afterEdit();'), 'panel reloads after edits');
});
