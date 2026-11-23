import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v1137 — "1M model shown as 200,000" — THE OFFLINE UI CHAIN
// ------------------------------------------------------------
// The founder: "أنا أحيانا بكون مستخدم موديل بيكون الكونتكست نفسه نافذة
// السياق مليون، اطلع كيف بحط لي اياها 200,000 ... يجب أن يكون جايبها من المصدر."
//
// D13 proved ONLY the injected-catalog path ("13/13"). At RUNTIME the live
// OpenRouter catalog is fetched only when the picker opens / a provider is
// enabled — on a cold/offline start there is no row, so costs.ts's generic
// 200k leaked for genuine 1M models (e.g. claude-sonnet-4.5, which the
// provider reports as 1,000,000 while costs.ts pins it to 200k).
//
// This suite drives the REAL `kdx:model:info` IPC handler (bundled with the
// real openrouterCatalog.ts + costs.ts; unrelated services stubbed), then
// feeds its answer into the REAL ContextLens via SSR. Proof:
//   1. a 1M fixture id -> handler returns 1,000,000, not 200,000;
//   2. the curated fallback also returns 1M while costs.ts still says 200k;
//   3. unknown ids stay honestly ≈200k (no invented 1M);
//   4. the orb prints 1,000,000 and NEVER a false 100%.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const IPC_BUNDLE = join(ROOT, 'tests', '.v1137-ipc.bundle.cjs');
const CTX_BUNDLE = join(ROOT, 'tests', '.v1137-ctx.bundle.cjs');
const LENS_BUNDLE = join(ROOT, 'tests', '.v1137-lens.bundle.cjs');
const IPC_SRC = readFileSync(join(ROOT, 'electron', 'ipc.ts'), 'utf8');
const CATALOG_SRC = readFileSync(join(ROOT, 'electron', 'services', 'openrouterCatalog.ts'), 'utf8');
const LENS_SRC = readFileSync(join(ROOT, 'src', 'components', 'ContextLens.tsx'), 'utf8');

let bridge;        // real handler + real catalog/costs helpers
let ctx;           // real src/lib/ctx.ts
let lens;          // real ContextLens + store
let React;
let renderToStaticMarkup;
let handlers;

before(async () => {
  // ---- 1) REAL IPC handler. Stub only unrelated modules so registerIpc()
  //         can run; openrouterCatalog.ts + costs.ts stay REAL and shared. ----
  await esbuild.build({
    stdin: {
      contents:
        "export { registerIpc } from './electron/ipc';" +
        "export { __seedOpenRouterCatalogForTest, __resetOpenRouterCatalogForTest, " +
        "openrouterContextFor, curatedOneMWindowFor, resolveModelWindow, " +
        "parseOpenRouterModels } from './electron/services/openrouterCatalog';" +
        "export { contextWindowInfo } from './electron/agent/costs';",
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: IPC_BUNDLE,
    external: ['os', 'fs', 'path', 'child_process'],
    plugins: [{
      name: 'v1137-stubs',
      setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'ep' }));
        b.onLoad({ filter: /.*/, namespace: 'ep' }, () => ({
          contents:
            'const h={};globalThis.__V1137_HANDLERS__=h;' +
            'module.exports={ipcMain:{handle:(c,f)=>{h[c]=f;},on(){},once(){},removeHandler(){}},' +
            'BrowserWindow:class{},dialog:{},shell:{}};',
          loader: 'js',
        }));
        b.onResolve({ filter: /^\.{1,2}\// }, (a) => {
          const keep = ['services/openrouterCatalog', 'agent/costs', 'electron/ipc'];
          if (keep.some((k) => a.path.endsWith(k))) return null;
          return { path: a.path, namespace: 'gen' };
        });
        b.onLoad({ filter: /.*/, namespace: 'gen' }, () => ({
          // Universal mock: any property/call/deep access resolves to itself.
          contents:
            'let s;const proto=new Proxy({},{get:()=>s,has:()=>true});' +
            's=new Proxy(function(){},{get:(t,k)=>(k==="__esModule"?false:k==="then"?undefined:' +
            'typeof k==="symbol"?undefined:s),getPrototypeOf:()=>proto,apply:()=>s,construct:()=>s});' +
            'module.exports=s;',
          loader: 'js',
        }));
      },
    }],
  });
  bridge = require(IPC_BUNDLE);
  bridge.registerIpc({ getMainWindow: () => null });
  handlers = globalThis.__V1137_HANDLERS__;
  assert.ok(handlers && typeof handlers['kdx:model:info'] === 'function',
    'the REAL kdx:model:info handler must be registered');

  // Real src/lib/ctx.ts (pure math) in its own bundle.
  esbuild.buildSync({
    entryPoints: [join(ROOT, 'src', 'lib', 'ctx.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: CTX_BUNDLE,
  });
  ctx = require(CTX_BUNDLE);

  // ---- 2) REAL ContextLens via SSR (effects do not run under SSR). ----
  globalThis.window = {
    surnia: new Proxy({}, {
      get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => Promise.resolve(undefined)),
    }),
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false }),
    setTimeout: () => 1, clearTimeout() {},
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  esbuild.buildSync({
    stdin: {
      contents:
        "export { ContextLens } from './src/components/ContextLens';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: LENS_BUNDLE,
    loader: { '.css': 'empty' },
    external: ['electron', 'react', 'react/jsx-runtime', 'react-dom', 'lucide-react'],
  });
  lens = require(LENS_BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  bridge?.__resetOpenRouterCatalogForTest?.();
  for (const f of [IPC_BUNDLE, CTX_BUNDLE, LENS_BUNDLE]) {
    try { if (existsSync(f)) unlinkSync(f); } catch { /* gone */ }
  }
});

const infoFor = (id) => handlers['kdx:model:info']({ sender: {} }, id);
const ONE_M = 1_000_000;
const usage = (input, output = 0) => ({ inputTokens: input, outputTokens: output, costUsd: 0 });

/** A real OpenRouter-shaped row (the shape parseOpenRouterModels emits). */
const row = (id, ctxLength) => ({
  id, name: id, ctx: ctxLength, free: false,
  price: { prompt: '0.000002', completion: '0.00001', cacheRead: null, cacheWrite: null },
});

// ------------------------------------------------------------
// 1 · THE REAL HANDLER WITH A LIVE 1M FIXTURE
// ------------------------------------------------------------
test('v1137: real kdx:model:info returns 1,000,000 for a live 1M fixture — never 200,000', async () => {
  bridge.__resetOpenRouterCatalogForTest();
  bridge.__seedOpenRouterCatalogForTest([row('anthropic/claude-sonnet-4.5', ONE_M)]);
  for (const id of ['anthropic/claude-sonnet-4.5', 'claude-sonnet-4.5']) {
    const info = await infoFor(id);
    assert.equal(info.contextWindow, ONE_M, `"${id}" must show the provider's 1M window`);
    assert.notEqual(info.contextWindow, 200_000, 'the 200k default must never leak for a 1M model');
    assert.equal(info.ctxEstimated, false, 'a provider/catalog 1M window is exact, not ≈');
  }
});

test('v1137: a real /api/v1/models payload is parsed and reaches the handler exactly', async () => {
  bridge.__resetOpenRouterCatalogForTest();
  const rows = bridge.parseOpenRouterModels({
    data: [
      { id: 'anthropic/claude-haiku-5.5', context_length: 1_000_000, pricing: { prompt: '0.000001', completion: '0.000005' } },
      { id: 'anthropic/claude-sonnet-4.5', context_length: 1_000_000, pricing: { prompt: '0.000002', completion: '0.00001' } },
    ],
  });
  assert.deepEqual(rows.map((r) => r.ctx), [ONE_M, ONE_M]);
  bridge.__seedOpenRouterCatalogForTest(rows);
  const info = await infoFor('anthropic/claude-haiku-5.5');
  assert.equal(info.contextWindow, ONE_M);
});

// ------------------------------------------------------------
// 2 · THE CURATED (OFFLINE) FALLBACK — the actual founder bug
// ------------------------------------------------------------
test('v1137: offline curated fallback also returns 1M for the founder\'s ids', async () => {
  bridge.__resetOpenRouterCatalogForTest(); // NO live catalog — the cold-start case
  const ids = [
    'claude-sonnet-4.5', 'anthropic/claude-sonnet-4.5', // costs.ts pins this to 200k
    'claude-sonnet-5.5', 'anthropic/claude-sonnet-5.5',
    'claude-haiku-5.5', 'claude-haiku-4-5', 'claude-opus-5.5',
    'gemini-4-argon', 'google/gemini-4-neon', 'deepseek-v4', 'qwen4-max',
  ];
  for (const id of ids) {
    const info = await infoFor(id);
    assert.ok(info.contextWindow >= ONE_M,
      `"${id}" is 1M-class but resolved to ${info.contextWindow}`);
    assert.notEqual(info.contextWindow, 200_000,
      `HARD FAIL: 1M model "${id}" shown as 200,000`);
    assert.equal(info.ctxEstimated, false, `"${id}" is known, not an ≈ default`);
  }
});

test('v1137: root cause isolated — costs.ts still says 200k for claude-sonnet-4.5', () => {
  // Proof that the high-precision table in openrouterCatalog.ts is what
  // rescues the offline path (costs.ts is owned by another agent, untouched).
  assert.equal(bridge.contextWindowInfo('claude-sonnet-4.5').ctx, 200_000);
  assert.equal(bridge.curatedOneMWindowFor('claude-sonnet-4.5'), ONE_M);
  assert.equal(
    bridge.resolveModelWindow('claude-sonnet-4.5', null, { ctx: 200_000, estimated: false }).contextWindow,
    ONE_M,
  );
});

test('v1137: unknown ids remain honestly ≈200k — no invented 1M', async () => {
  bridge.__resetOpenRouterCatalogForTest();
  const info = await infoFor('totally-unknown-model-zzz');
  assert.equal(info.contextWindow, 200_000);
  assert.equal(info.ctxEstimated, true, 'the generic default must carry the ≈ marker');
});

test('v1137: provider live value stays authoritative over the curated table', async () => {
  bridge.__resetOpenRouterCatalogForTest();
  bridge.__seedOpenRouterCatalogForTest([row('anthropic/claude-sonnet-4.5', 128_000)]);
  const info = await infoFor('claude-sonnet-4.5');
  assert.equal(info.contextWindow, 128_000, 'when the provider reports a smaller real window, it wins');
  assert.equal(info.ctxEstimated, false);
  bridge.__resetOpenRouterCatalogForTest();
});

// ------------------------------------------------------------
// 3 · THE ORB — fed by the real handler's answer
// ------------------------------------------------------------
const seed = ({ fill = 0, window = ONE_M, estimated = false } = {}) => {
  const prev = lens.useStore.getState();
  lens.useStore.setState({
    settings: { ...prev.settings, language: 'en', numerals: 'western', model: { provider: 'anthropic', model: 'claude-sonnet-4.5' } },
    running: false,
    liveStreamChars: 0,
    ctxWindowEstimated: estimated,
    sessionUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    lastTurnUsage: fill > 0 ? usage(fill) : null,
    ctxWindow: window,
  });
};
const renderOrb = () => renderToStaticMarkup(React.createElement(lens.ContextLens, { compact: true }));
const arc = (html) => {
  const el = html.match(/<circle[^>]*class="ctx-orb-arc"[^>]*>/);
  assert.ok(el, 'arc rendered');
  const dash = el[0].match(/stroke-dasharray="([\d.eE+-]+)\s+([\d.eE+-]+)"/);
  return { arc: Number(dash[1]), circumference: Number(dash[2]) };
};

test('v1137: orb shows 1,000,000 (not 200,000) when fed the real handler answer', async () => {
  bridge.__resetOpenRouterCatalogForTest();
  const info = await infoFor('claude-sonnet-4.5'); // offline -> curated 1M rescue
  assert.equal(info.contextWindow, ONE_M);
  seed({ fill: 100_000, window: info.contextWindow, estimated: info.ctxEstimated });
  const html = renderOrb();
  // SSR's useDigits() is identity (no locale grouping); the real UI groups it.
  assert.match(html, /1000000|1,000,000/, 'orb tip prints the real 1M window');
  assert.doesNotMatch(html, /200,?000/, 'orb NEVER prints 200,000 for a 1M model');
  assert.ok(html.includes('>10%</span>'), '100k / 1M = 10%, not 50%');
  const a = arc(html);
  assert.ok(Math.abs(a.arc - 0.1 * a.circumference) < 1e-6, 'arc = exact 10% of 2πr');
});

test('v1137: no false 100% — 250k in a 1M window is 25%, not full', () => {
  seed({ fill: 250_000, window: ONE_M });
  const html = renderOrb();
  assert.ok(html.includes('>25%</span>'));
  assert.doesNotMatch(html, />100%<\/span>/, 'no fabricated full ring');
  assert.equal(ctx.contextFillPercent(250_000, ONE_M), 25);
});

test('v1137: an outgrown ≈200k window still never fabricates 100%', () => {
  seed({ fill: 250_000, window: 200_000, estimated: true });
  const html = renderOrb();
  assert.equal(ctx.contextFillPercent(250_000, 200_000, true), null);
  assert.doesNotMatch(html, />100%<\/span>/);
  assert.equal(arc(html).arc, 0, 'no trustworthy percentage -> empty arc');
});

// ------------------------------------------------------------
// 4 · SOURCE GUARDS — the live code is wired to the shared resolver
// ------------------------------------------------------------
test('v1137: source guards — handler + catalog + lens use the v1137 path', () => {
  const handler = IPC_SRC.slice(IPC_SRC.indexOf("handle('kdx:model:info'"), IPC_SRC.indexOf("handle('kdx:ai:complete'"));
  assert.match(handler, /const catalogCtx = openrouterContextFor\(id\)/, 'provider-first preserved');
  assert.match(handler, /const info = contextWindowInfo\(id\)/);
  assert.match(handler, /const ctx = catalogCtx \?\? info\.ctx/, 'v1136 guard still holds');
  assert.match(handler, /resolveModelWindow\(id, catalogCtx/, 'handler delegates to the high-precision resolver');

  assert.match(CATALOG_SRC, /const CURATED_ONE_M_WINDOWS/, 'high-precision curated table exists');
  assert.match(CATALOG_SRC, /claude-sonnet-4-5/, "founder's mismatched id is in the table");
  assert.match(CATALOG_SRC, /claude-haiku-4-5/, 'haiku is in the table');
  assert.match(CATALOG_SRC, /export function resolveModelWindow\(/, 'shared resolver exported');
  assert.match(CATALOG_SRC, /bareRouterIdKey\(r\.id\) === want/, 'bare ids find vendor-prefixed live rows');

  assert.match(LENS_SRC, /isOneMClassWindow/, 'lens knows the 1M-class invariant');
  assert.match(LENS_SRC, /api\s*\.modelInfo\(model\.model\)/, 'lens resolves from the real bridge');
});
