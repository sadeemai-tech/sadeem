import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// v11.11 (A6) — PROVIDERS · CONTEXT suite. The founder complaints reported
// TODAY, exercised against the REAL code:
//
//   1. Provider + its models must appear immediately in ModelPicker + Settings
//      (store reactivity): updateSettings deep-merges provider entries so a
//      stale-closure patch can no longer wipe `enabled`, and the picker merges
//      each enabled provider's cached live list (lastModels).
//
//   3. CONTEXT BAR EXACTNESS — the founder's formula, to the token:
//         fill% = (prompt_tokens_including_cached + generated_tokens_of_
//                  current_request) / model_context_window
//      · context window = provider-reported (live OpenRouter catalog) when the
//        active provider is OpenRouter, else the per-model catalog table, else
//        the honest 200k default marked "≈";
//      · cached input counts toward occupancy (it is INSIDE prompt_tokens —
//        never subtracted, never double-counted);
//      · the bar updates DURING streaming (last exact fill + chars/4 of the
//        streamed output, shown "≈") and is replaced by the exact figure on
//        message_end.
//
//   4. USAGE PRECISION — per-message / per-provider / per-day / per-attempt
//      rows all sum to the session total; every displayed percentage is
//      recomputed from the same numbers (drift ≤ 0.1%). Driven through the
//      REAL store reducer (ingestAgentEvent), not a re-implementation.
//
// Harness posture: esbuild bundles + electron stub + scripted local HTTP
// mock (node:http, zero network) — same as v1110-providers-plans / v1110-usage.
// Renderer components are rendered with react-dom/server against the REAL
// zustand store (no DOM needed; effects are skipped by the server renderer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1111-a6-'));

process.env.SURNIA_TURN_RETRY_DELAYS_MS = '8';

// ---------- esbuild bundle ----------
function bundle(entry, out, extra = []) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, 
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--jsx=automatic',
    '--define:process.env.NODE_ENV="test"',
    `--outfile=${out}`,
    '--external:electron',
    '--external:@xterm/xterm',
    '--external:@xterm/addon-fit',
    // v11.12 — svg illustrations (v11.11 A9-DESIGN) need a loader in test bundles
    '--loader:.svg=dataurl',
    '--external:monaco-editor',
    '--external:@monaco-editor/react',
    // ONE React/zustand copy: keep them external so the bundle and the test
    // file resolve to the same instances (hook dispatcher sanity).
    '--external:react',
    '--external:react-dom',
    '--external:zustand',
    ...extra,
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
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: async () => {} },
    Notification: { isSupported: () => false },
    nativeImage: { createEmpty: () => ({}) },
    Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
    dialog: { showOpenDialog: async () => ({ canceled: true }) },
    powerMonitor: { on() {} },
  };`,
);

// react/react-dom stay EXTERNAL (one copy across bundle + test) — link the
// project's packages into the tmp tree so require() resolves them. A directory
// *junction* on Windows is the portable equivalent of a POSIX symlink: it needs
// no Developer Mode/elevation, and Node resolves both paths to the SAME real
// module (one React dispatcher). A plain copy created a second React instance
// and every hook render died with "Cannot read properties of null (reading
// 'useCallback')" — hence the junction-first, copy-only-as-fallback order.
const nmDir = join(tmp, 'node_modules');
mkdirSync(nmDir, { recursive: true });
for (const pkg of ['react', 'react-dom', 'scheduler', 'loose-envify', 'js-tokens']) {
  const src = join(ROOT, 'node_modules', pkg);
  const dst = join(nmDir, pkg);
  if (existsSync(dst)) continue;
  try {
    symlinkSync(src, dst, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    cpSync(src, dst, { recursive: true });
  }
}
// zustand is copied + lightly patched in the TMP copy only (the project's
// node_modules is untouched): the server renderer reads the store snapshot via
// api.getInitialState() — the state at create() time — so a harness that seeds
// with setState would render stale defaults. The patch adds ONE optional hook
// (`setServerInitialState`) letting the harness point the SERVER snapshot at
// the live state, exactly what a hydrated client sees. Real app: unchanged.
{
  const zSrc = join(ROOT, 'node_modules', 'zustand');
  const zDst = join(nmDir, 'zustand');
  cpSync(zSrc, zDst, { recursive: true });
  const reactJs = join(zDst, 'react.js');
  let code = readFileSync(reactJs, 'utf8');
  code = code.replace(
    '() => selector(api.getInitialState())',
    '() => selector(api.__getInitialState ? api.__getInitialState() : api.getInitialState())',
  );
  code = code.replace(
    '  Object.assign(useBoundStore, api);\n  return useBoundStore;',
    '  Object.assign(useBoundStore, api);\n  useBoundStore.setServerInitialState = (fn) => { api.__getInitialState = fn; };\n  return useBoundStore;',
  );
  writeFileSync(reactJs, code);
}

// ---------- bundles ----------
const provPath = join(tmp, 'providers.cjs');
bundle('electron/services/providerService.ts', provPath);
const providers = require(provPath);

const storeSvcPath = join(tmp, 'storeService.cjs');
bundle('electron/services/storeService.ts', storeSvcPath);
const storeSvc = require(storeSvcPath);

const catalogPath = join(tmp, 'catalog.cjs');
bundle('electron/services/openrouterCatalog.ts', catalogPath);
const catalog = require(catalogPath);

const costsPath = join(tmp, 'costs.cjs');
bundle('electron/agent/costs.ts', costsPath);
const costs = require(costsPath);

const ctxPath = join(tmp, 'ctx.cjs');
bundle('src/lib/ctx.ts', ctxPath);
const ctx = require(ctxPath);

const usageLibPath = join(tmp, 'usageLib.cjs');
bundle('src/lib/usage.ts', usageLibPath);
const usageLib = require(usageLibPath);

// ONE bundle carrying store + ModelPicker (shared store instance)
const renderPath = join(tmp, 'render.cjs');
bundle('tests/fixtures/a6-render-entry.ts', renderPath);
const ui = require(renderPath);

const React = require(join(ROOT, 'node_modules', 'react'));
const { renderToStaticMarkup } = require(join(ROOT, 'node_modules', 'react-dom', 'server'));

// ---------- scripted local mock (zero network) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

function startMock() {
  const sockets = new Set();
  const modelCalls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      if (req.url === '/v1/models' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          data: [
            { id: 'mock-a', context_length: 200_000, created: 1_700_000_002 },
            { id: 'mock-b', context_length: 128_000, created: 1_700_000_001 },
          ],
        }));
        return;
      }
      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch { /* {} */ }
        modelCalls.push({ model: body.model, at: Date.now() });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(sseChunk({ content: 'Done.' }));
        res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 500, completion_tokens: 20 }, choices: [] })}\n\n`);
        res.write(sseChunk({}, 'stop'));
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `UNSCRIPTED ${req.method} ${req.url}` } }));
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return {
    modelCalls,
    port: () => listening,
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

const fmtInt = (n) => n.toLocaleString('en-US');

/**
 * Seed the renderer store for a SERVER render. zustand v5's server snapshot
 * is api.getInitialState() (NOT the current state), so SSR would otherwise
 * see the DEFAULT state no matter what setState seeded — mirror the browser
 * by pointing the initial-state hook at the live state for the harness only.
 */
function seedStore(patch) {
  ui.useStore.setState(patch);
  // patched tmp-only zustand: server snapshot follows the live state
  ui.useStore.setServerInitialState?.(() => ui.useStore.getState());
  return ui.useStore.getState();
}

// ============================================================
// 3 · Model picker visibility via the store (complaint #1b)
// ============================================================
test('A6 · model picker shows an enabled provider\'s cached live models immediately', () => {
  const { useStore, ModelPicker, providerModelIds } = ui;
  const base = {
    language: 'en',
    theme: 'obsidian',
    permissionMode: 'default',
    model: { provider: 'deepseek', model: 'deepseek-flash' },
    providers: {
      deepseek: { apiKey: 'sk-ds', enabled: true, lastModels: ['ds-live-alpha', 'ds-live-beta'] },
      anthropic: { apiKey: 'sk-anth' },
    },
  };

  // the slice helper: lastModels wins, presets are the fallback
  assert.deepEqual(
    providerModelIds(base.providers.deepseek, ['deepseek-flash']),
    ['ds-live-alpha', 'ds-live-beta'],
  );
  assert.deepEqual(providerModelIds(undefined, ['preset-only']), ['preset-only']);

  seedStore({ settings: base });
  const html1 = renderToStaticMarkup(React.createElement(ModelPicker, { open: true, onClose: () => {} }));
  assert.ok(html1.includes('ds-live-alpha'), 'FAILING BEFORE FIX: the picker ignored ProviderEntry.lastModels');
  assert.ok(html1.includes('ds-live-beta'));

  // reactivity: a provider added WHILE the app runs appears on the next render
  const withOpenRouter = {
    ...base,
    providers: {
      ...base.providers,
      openrouter: { apiKey: 'sk-or', enabled: true, lastModels: ['or-live-model-x'] },
    },
  };
  seedStore({ settings: withOpenRouter });
  const html2 = renderToStaticMarkup(React.createElement(ModelPicker, { open: true, onClose: () => {} }));
  assert.ok(html2.includes('or-live-model-x'), 'store reactivity — newly added providers appear without a remount');
});

// ============================================================
// 4 · updateSettings heals stale-closure provider patches (store reactivity)
// ============================================================
test('A6 · updateSettings deep-merges provider entries — a stale patch cannot wipe enabled/lastModels', () => {
  const { useStore } = ui;
  const seeded = {
    language: 'en',
    model: { provider: 'deepseek', model: 'deepseek-flash' },
    providers: { deepseek: { apiKey: 'sk-ds', enabled: true, lastModels: ['m1', 'm2'], fetchedAt: 111 } },
    usageLog: [],
  };
  useStore.setState({ settings: seeded });

  // EXACTLY the stale shape ModelsSection.fetchModels builds from an old
  // closure: no `enabled` key → the enable flag used to disappear.
  useStore.getState().updateSettings({
    providers: { deepseek: { lastModels: ['m1', 'm2', 'm3'], fetchedAt: 222 } },
  });
  const p = useStore.getState().settings.providers.deepseek;
  assert.equal(p.enabled, true, 'FAILING BEFORE FIX: stale patch dropped the enabled flag');
  assert.equal(p.apiKey, 'sk-ds', 'credentials survive the merge');
  assert.deepEqual(p.lastModels, ['m1', 'm2', 'm3'], 'patched fields still apply');

  // an explicit disable still wins (merge never resurrects user intent)
  useStore.getState().updateSettings({ providers: { deepseek: { enabled: false } } });
  assert.equal(useStore.getState().settings.providers.deepseek.enabled, false);
});

// ============================================================
// 5 · CONTEXT MATH EXACTNESS — the founder's formula, five cases
//     fill = prompt_tokens (cache INSIDE) + generated_tokens_of_current_request
// ============================================================
test('A6 · ctx (1) exact fill: 12,482 in (3,000 cached inside) + 700 generated / 200,000 → "13,182 / 200,000 tokens · 6.6%"', () => {
  const u = { inputTokens: 12_482, outputTokens: 700, cacheReadTokens: 3_000, cacheCreationTokens: 0 };
  const fill = ctx.ctxFillTokens(u);
  assert.equal(fill, 13_182, 'prompt (cache included) + generated of the current request');
  // cached input counts toward occupancy — never subtracted
  assert.equal(fill, 12_482 + 700, 'cached 3,000 stays INSIDE the 12,482 (no subtraction, no double count)');
  const pct = ctx.ctxPctExact(u, 200_000);
  assert.ok(Math.abs(pct - 6.591) < 1e-9, `exact pct 6.591 (got ${pct})`);
  assert.equal(pct.toFixed(1), '6.6', 'one-decimal display');
  // the exact display string (ContextLens / StatusBar popover format)
  assert.equal(`${fmtInt(fill)} / ${fmtInt(200_000)} tokens · ${pct.toFixed(1)}%`, '13,182 / 200,000 tokens · 6.6%');
});

test('A6 · ctx (2) Anthropic split: 150,000 in (120k cache-read + 10k cache-write inside) + 5,000 out / 1,000,000 → 15.5%', () => {
  // providers.ts folds cache_read/creation INTO input_tokens for Anthropic
  const u = { inputTokens: 150_000, outputTokens: 5_000, cacheReadTokens: 120_000, cacheCreationTokens: 10_000 };
  const fill = ctx.ctxFillTokens(u);
  assert.equal(fill, 155_000, 'cache segments are parts of the prompt, never additions');
  const pct = ctx.ctxPctExact(u, 1_000_000);
  assert.ok(Math.abs(pct - 15.5) < 1e-9, `15.5% exact (got ${pct})`);
  // segment math stays inside the fill: fresh = the PROMPT remainder
  // (150,000 − 120,000 − 10,000), generated = its own 5,000 slice
  const fresh = (u.inputTokens ?? 0) - (u.cacheReadTokens ?? 0) - (u.cacheCreationTokens ?? 0);
  assert.equal(fresh, 20_000);
  assert.equal(u.outputTokens ?? 0, 5_000);
  assert.equal(fresh + (u.cacheReadTokens ?? 0) + (u.cacheCreationTokens ?? 0) + (u.outputTokens ?? 0), fill);
});

test('A6 · ctx (3) streaming: bar moves DURING the stream — last exact fill + chars/4 of streamed output, shown ≈', () => {
  // after turn N-1: 13,182 (12,482 in + 700 out) is the last EXACT fill
  const last = { inputTokens: 12_482, outputTokens: 700 };
  assert.equal(ctx.ctxFillTokens(last), 13_182);
  // 4,000 chars streamed so far in turn N → +1,000 est → the bar moves NOW
  const live = ctx.liveFillEstimate(ctx.ctxFillTokens(last), 4_000);
  assert.equal(live, 14_182, 'live fill updates during streaming (not only at finalize)');
  assert.equal(ctx.estimateTokensFromChars(4_000), 1_000);
  const pctLive = ctx.ctxPctLiveOf(last, 200_000, 4_000);
  assert.ok(Math.abs(pctLive - 7.091) < 1e-9, `live pct 7.091 (got ${pctLive})`);
  assert.equal(pctLive.toFixed(1), '7.1', 'one-decimal live display');
  // monotonic during the stream: more chars → strictly larger fill
  assert.ok(ctx.liveFillEstimate(13_182, 10_000) > live);
});

test('A6 · ctx (4) finalize replaces the ≈ estimate with the provider EXACT figure (no drift)', () => {
  const exact = { inputTokens: 13_482, outputTokens: 1_000, cacheReadTokens: 2_000, cacheCreationTokens: 0 };
  const fill = ctx.ctxFillTokens(exact);
  assert.equal(fill, 14_482, 'message_end exact fill = prompt + generated');
  const pct = ctx.ctxPctExact(exact, 200_000);
  assert.ok(Math.abs(pct - 7.241) < 1e-9, `exact pct 7.241 (got ${pct})`);
  assert.equal(pct.toFixed(1), '7.2');
  assert.notEqual(fill, ctx.liveFillEstimate(13_182, 4_000), 'the ≈ estimate is gone once exact usage lands');
});

test('A6 · ctx (5) window resolution: provider-reported catalog → per-model table → honest ≈200k; pct clamps at 100', () => {
  // unknown window → 0% (never a fake percentage)
  assert.equal(ctx.ctxPctExact({ inputTokens: 12_482, outputTokens: 700 }, 0), 0);
  // clamp: 250,000 in a 200,000 window → 100, never >100
  assert.equal(ctx.ctxPctExact({ inputTokens: 250_000, outputTokens: 0 }, 200_000), 100);
  // per-model table: known ids exact, unknown → 200k default flagged ≈
  assert.deepEqual(costs.contextWindowInfo('claude-sonnet-4-6'), { ctx: 1_000_000, estimated: false });
  assert.deepEqual(costs.contextWindowInfo('totally-unknown-xyz'), { ctx: 200_000, estimated: true });
  // provider-reported (OpenRouter live catalog) beats the table — including
  // where the table's generic row would misread the exact router model
  const rows = [
    { id: 'vendor-x/obscure-1', name: 'Obscure 1', ctx: 983_041, free: false },
    { id: 'vendor-x/obscure-free', name: 'Obscure Free', ctx: 32_768, free: true },
    { id: 'deepseek/deepseek-v4.1-flash-1017', name: 'DS', ctx: 983_041, free: false },
  ];
  assert.deepEqual(
    costs.contextWindowInfo('vendor-x/obscure-1'),
    { ctx: 200_000, estimated: true },
    'the per-model table does NOT know router-only ids (honest ≈200k)',
  );
  assert.equal(costs.contextWindowInfo('deepseek/deepseek-v4.1-flash-1017').ctx, 1_000_000, 'table generic row');
  assert.equal(catalog.openrouterContextFor('vendor-x/obscure-1', rows), 983_041, 'catalog carries the EXACT provider-reported window');
  assert.equal(
    catalog.openrouterContextFor('deepseek/deepseek-v4.1-flash-1017', rows),
    983_041,
    'provider-reported window OVERRIDES the generic table row for the same id',
  );
  assert.equal(catalog.openrouterContextFor('not/in-catalog', rows), null, 'no catalog row → fall through to the table');
  assert.equal(catalog.openrouterContextFor('', rows), null);
});

test('A6 · openrouterCatalog caches the live fetch and serves exact ctx lookups', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    if (!String(url).includes('openrouter.ai')) throw new Error(`UNSCRIPTED ${url}`);
    calls++;
    return new Response(JSON.stringify({
      data: [
        { id: 'vendor-x/obscure-1', name: 'Obscure 1', context_length: 983_041, pricing: { prompt: '0.001', completion: '0.002' }, architecture: { input_modalities: ['text', 'image'] } },
        { id: 'vendor-x/obscure-free', name: 'Obscure Free', context_length: 32_768, pricing: { prompt: '0', completion: '0' } },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const rows = await catalog.openrouterLiveModels('sk-or-catalog-test');
    assert.equal(rows.length, 2);
    assert.equal(calls, 1, 'one network fetch');
    assert.equal(catalog.cachedOpenRouterModels().length, 2, 'module cache populated');
    // second call within the TTL → cache, no second fetch
    await catalog.openrouterLiveModels('sk-or-catalog-test');
    assert.equal(calls, 1, 'TTL cache prevents refetch');
    assert.equal(catalog.openrouterContextFor('vendor-x/obscure-1'), 983_041, 'exact provider-reported window via cache');
    assert.equal(catalog.openrouterContextFor('vendor-x/obscure-free'), 32_768);
    assert.equal(catalog.openrouterContextFor('nope/nope'), null);
    assert.equal(catalog.openrouterContextFor(''), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ============================================================
// 6 · USAGE PRECISION — per-message / per-provider / per-attempt / per-day
//     reconciliation through the REAL store reducer
// ============================================================
test('A6 · store-level usage: per-message + per-provider + per-attempt + per-day rows sum to the session total', () => {
  const { useStore } = ui;
  const { runUsageView, accumulateUsage, emptySessionUsage } = ctx;

  const att = (p, m, i, o, c, extra = {}) => ({ provider: p, model: m, inputTokens: i, outputTokens: o, costUsd: c, ...extra });

  // session seed: one user row + one streaming assistant row
  const session = {
    id: 'a6-sess',
    title: 'a6',
    messages: [
      { id: 'u1', role: 'user', kind: 'text', content: 'go', timestamp: 1 },
      { id: 'a1', role: 'assistant', kind: 'text', content: '', streaming: true, timestamp: 2 },
    ],
    createdAt: 1,
  };
  useStore.setState({ session, sessionUsage: emptySessionUsage(), lastTurnUsage: null, running: true });
  // usageLog for today (the store writes per-DAY rows on message_end)
  const today = new Date().toISOString().slice(0, 10);
  useStore.setState({ settings: { language: 'en', model: { provider: 'custom', model: 'mock-a' }, providers: {}, usageLog: [] } });

  // ---- turn 1: failover 2-attempt turn (dead attempt billed + survivor) ----
  const t1 = {
    inputTokens: 1_203, outputTokens: 50, costUsd: 0.0031,
    cacheReadTokens: 300, cacheCreationTokens: 0,
    runInput: 3_203, runOutput: 150, runCost: 0.0127, runCacheRead: 800, runCacheCreation: 0,
    attempts: [
      att('custom', 'mock-a', 1_203, 50, 0.0031, { cacheReadTokens: 300 }),
      att('zai', 'glm-4.7', 2_000, 100, 0.0096, { cacheReadTokens: 500 }),
    ],
  };
  useStore.getState().ingestAgentEvent({ type: 'message_end', usage: t1, stopReason: 'end_turn' });

  // ---- turn 2: its own assistant row opens before the run ----
  const cur = useStore.getState().session;
  useStore.setState({
    session: {
      ...cur,
      messages: [
        ...cur.messages,
        { id: 'u2', role: 'user', kind: 'text', content: 'again', timestamp: 3 },
        { id: 'a2', role: 'assistant', kind: 'text', content: '', streaming: true, timestamp: 4 },
      ],
    },
  });

  // ---- turn 2: normal single-attempt turn (provider-exact) ----
  const t2 = {
    inputTokens: 5_000, outputTokens: 400, costUsd: 0.0064,
    cacheReadTokens: 1_000, cacheCreationTokens: 0,
    runInput: 5_000, runOutput: 400, runCost: 0.0064, runCacheRead: 1_000, runCacheCreation: 0,
    attempts: [att('custom', 'mock-a', 5_000, 400, 0.0064, { cacheReadTokens: 1_000 })],
  };
  useStore.getState().ingestAgentEvent({ type: 'message_end', usage: t2, stopReason: 'end_turn' });

  const st = useStore.getState();

  // ---- per-message rows carry the whole-turn run view ----
  const rows = st.session.messages.filter((m) => m.usage);
  assert.equal(rows.length, 2, 'both turns attached to transcript rows');
  assert.equal(rows[0].usage.costUsd, t1.runCost, 'row 1 == runCost (turn 1)');
  assert.equal(rows[1].usage.costUsd, t2.runCost, 'row 2 == runCost (turn 2)');

  // ---- THE RECONCILIATION: sum(per-message) == sessionUsage, exactly ----
  const rowCost = Math.round(rows.reduce((a, m) => a + m.usage.costUsd, 0) * 1e6);
  const rowIn = rows.reduce((a, m) => a + m.usage.inputTokens, 0);
  const rowOut = rows.reduce((a, m) => a + m.usage.outputTokens, 0);
  assert.equal(rowCost, Math.round(st.sessionUsage.costUsd * 1e6), 'sum(rows.costUsd) == sessionUsage.costUsd (µ$ exact)');
  assert.equal(rowIn, st.sessionUsage.inputTokens, 'sum(rows.inputTokens) == sessionUsage.inputTokens');
  assert.equal(rowOut, st.sessionUsage.outputTokens, 'sum(rows.outputTokens) == sessionUsage.outputTokens');
  assert.equal(st.sessionUsage.costUsd, t1.runCost + t2.runCost, 'session total == runCost1 + runCost2');

  // ---- per-attempt rows sum to the run totals (billing honesty) ----
  const allAttempts = st.sessionUsage.attempts ?? [];
  assert.equal(allAttempts.length, 3, 'all 3 attempts ledgered (2 + 1)');
  const attemptCost = Math.round(allAttempts.reduce((a, x) => a + x.costUsd, 0) * 1e6);
  const attemptIn = allAttempts.reduce((a, x) => a + x.inputTokens, 0);
  const attemptOut = allAttempts.reduce((a, x) => a + x.outputTokens, 0);
  assert.equal(attemptCost, Math.round(st.sessionUsage.costUsd * 1e6), 'sum(attempts.costUsd) == sessionUsage.costUsd');
  assert.equal(attemptIn, st.sessionUsage.inputTokens, 'sum(attempts.input) == sessionUsage.input');
  assert.equal(attemptOut, st.sessionUsage.outputTokens, 'sum(attempts.output) == sessionUsage.output');

  // ---- per-provider rows sum to the same total ----
  const byProvider = new Map();
  for (const a of allAttempts) {
    const cur = byProvider.get(a.provider) ?? { costUsd: 0, inputTokens: 0, outputTokens: 0 };
    cur.costUsd += a.costUsd;
    cur.inputTokens += a.inputTokens;
    cur.outputTokens += a.outputTokens;
    byProvider.set(a.provider, cur);
  }
  assert.deepEqual([...byProvider.keys()].sort(), ['custom', 'zai']);
  const provCost = Math.round([...byProvider.values()].reduce((a, v) => a + v.costUsd, 0) * 1e6);
  assert.equal(provCost, Math.round(st.sessionUsage.costUsd * 1e6), 'sum(per-provider) == sessionUsage.costUsd');
  assert.equal(
    byProvider.get('zai').inputTokens,
    allAttempts.filter((a) => a.provider === 'zai').reduce((a, x) => a + x.inputTokens, 0),
    'per-provider input consistent with its attempts',
  );

  // ---- per-day rows (settings.usageLog) sum to the same numbers ----
  const dayRow = st.settings.usageLog.find((e) => e.date === today);
  assert.ok(dayRow, 'a usageLog row exists for today');
  assert.equal(dayRow.tokens, t1.runInput + t1.runOutput + t2.runInput + t2.runOutput, 'day tokens == sum of turn run views');
  assert.equal(Math.round(dayRow.costUsd * 1e6), Math.round((t1.runCost + t2.runCost) * 1e6), 'day cost == sum of run costs (µ$ exact)');

  // ---- lastTurnUsage is the DELTA (the context bar's input), not the sum ----
  assert.deepEqual(
    { i: st.lastTurnUsage.inputTokens, o: st.lastTurnUsage.outputTokens },
    { i: t2.inputTokens, o: t2.outputTokens },
    'lastTurnUsage = the newest turn delta (prompt + generated of that request)',
  );
  // context fill from the last turn: 5,000 + 400 = 5,400 — never the session sum (10,753)
  assert.equal(ctx.ctxFillTokens(st.lastTurnUsage), 5_400);
  assert.notEqual(ctx.ctxFillTokens(st.lastTurnUsage), st.sessionUsage.inputTokens + st.sessionUsage.outputTokens);

  // ---- displayed percentages come from the same numbers (≤ 0.1% drift) ----
  const cached = st.sessionUsage.cacheReadTokens ?? 0;
  const fresh = Math.max(0, st.sessionUsage.inputTokens - cached - (st.sessionUsage.cacheCreationTokens ?? 0));
  const hitShown = Math.round((cached / (cached + fresh)) * 100); // TokenEconomyCard formula
  const hitRecomputed = (cached / (cached + fresh)) * 100;
  assert.ok(Math.abs(hitShown - hitRecomputed) <= 0.1, `hit-rate drift ≤ 0.1% (shown ${hitShown}, exact ${hitRecomputed})`);
  const ctxWindow = 200_000;
  const pctShown = Number(ctx.ctxPctExact(st.lastTurnUsage, ctxWindow).toFixed(1));
  const pctRecomputed = ((ctx.ctxFillTokens(st.lastTurnUsage) / ctxWindow) * 100);
  assert.ok(Math.abs(pctShown - pctRecomputed) <= 0.1, `context pct drift ≤ 0.1% (shown ${pctShown}, exact ${pctRecomputed})`);
});

// ============================================================
// 7 · settings persistence round-trip
// ============================================================
test('A6 · persistence round-trip: enabled + lastModels + decrypted key survive save→load', () => {
  const settings = {
    schemaVersion: 4,
    language: 'en',
    model: { provider: 'openrouter', model: 'deepseek/deepseek-chat' },
    providers: {
      openrouter: { apiKey: 'sk-or-roundtrip', enabled: true, lastModels: ['a/x', 'b/y'], fetchedAt: 42 },
      deepseek: { apiKey: 'sk-ds-roundtrip', enabled: false },
    },
    usageLog: [],
  };
  storeSvc.saveSettings(settings);
  const loaded = storeSvc.getSettings();
  assert.equal(loaded.providers.openrouter.enabled, true);
  assert.deepEqual(loaded.providers.openrouter.lastModels, ['a/x', 'b/y']);
  assert.equal(loaded.providers.openrouter.apiKey, 'sk-or-roundtrip', 'key decrypted on read');
  assert.equal(loaded.providers.deepseek.enabled, false, 'explicit disable survives');
});

// ============================================================
// 8 · structural wiring — the fixes are actually connected
// ============================================================
test('A6 · structural: model:info prefers the provider-reported window', () => {
  const ipc = readFileSync(join(ROOT, 'electron/ipc.ts'), 'utf8');
  const infoIdx = ipc.indexOf('openrouterContextFor');
  const tableIdx = ipc.indexOf('contextWindowInfo');
  assert.ok(infoIdx > 0, 'kdx:model:info consults the provider-reported catalog');
  assert.ok(infoIdx < tableIdx, '…BEFORE falling back to the per-model table');
});

test('cleanup', () => {
  delete process.env.SURNIA_TURN_RETRY_DELAYS_MS;
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
