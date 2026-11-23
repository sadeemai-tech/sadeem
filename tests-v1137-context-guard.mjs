// ============================================================
// v11.37 — INDEPENDENT GUARD C: CONTEXT WINDOW / ORB (1M vs 200k)
// ------------------------------------------------------------
// Founder's complaint M4: "the context window shows 200,000 for my 1M model,
// then fills to a fake 100%".
//
// DIAGNOSIS + TEST ONLY — no app source is edited. This script bundles the
// REAL electron/ipc.ts (kdx:model:info handler), the REAL renderer bridge
// src/lib/api.ts, the REAL src/lib/ctx.ts math, the REAL openrouterCatalog.ts
// and costs.ts into ONE shared module graph, injects a 1M model id through the
// catalog test hook, and drives the whole chain:
//   provider fixture -> kdx:model:info -> api.modelInfo -> ContextLens state
//   -> formatContextBreakdown / contextFillPercent / 1M stamp.
// It also checks the curated fallback for a known 1M model and the "no false
// 100%" contract. Local temp dirs + electron stub; no network, no model.
//
// Run: node tests-v1137-context-guard.mjs
// ============================================================
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const failures = [];
function check(id, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
  if (!ok) failures.push(`${id} — ${detail}`);
  return ok;
}
function loc(rel, needle) {
  try {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/);
    const i = lines.findIndex((l) => l.includes(needle));
    return `${rel}:${i >= 0 ? i + 1 : '?'}`;
  } catch { return `${rel}:?`; }
}
const src = (rel) => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };

// ------------------------------------------------------------
// electron stub: capture ipcMain handlers instead of opening a window
// ------------------------------------------------------------
const TMP = mkdtempSync(join(tmpdir(), 'sadeem-v1137-context-'));
const userDataDir = join(TMP, 'userdata');
mkdirSync(userDataDir, { recursive: true });
process.env.SURNIA_HOME = userDataDir;
process.env.SURNIA_SKIP_UI_GATE = '1';
globalThis.__v1137 = { handlers: {}, invoke: null };
const stubDir = join(TMP, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `
const P = { temp: ${JSON.stringify(TMP)}, userData: ${JSON.stringify(userDataDir)}, home: ${JSON.stringify(TMP)}, appData: ${JSON.stringify(TMP)} };
const G = globalThis.__v1137;
module.exports = {
  app: { getPath: (k) => P[k] ?? P.userData, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
  ipcMain: { handle: (ch, fn) => { G.handlers[ch] = fn; }, on() {}, removeAllListeners() {} },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showOpenDialog: async () => ({ canceled: true }) },
  Notification: { isSupported: () => false },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
  screen: {}, powerMonitor: { on() {} },
};`);

// The renderer bridge calls window.surnia.modelInfo(); wire it to the REAL
// captured ipc handler through the same channel name the preload uses.
globalThis.window = {
  surnia: {
    modelInfo: (modelId) => globalThis.__v1137.invoke('kdx:model:info', modelId),
  },
};

const bundlePath = join(TMP, 'context.bundle.cjs');
let mod;
try {
  esbuild.buildSync({
    stdin: {
      contents: [
        "export * as ipc from './electron/ipc';",
        "export * as api from './src/lib/api';",
        "export * as ctx from './src/lib/ctx';",
        "export * as catalog from './electron/services/openrouterCatalog';",
        "export * as costs from './electron/agent/costs';",
      ].join('\n'),
      resolveDir: ROOT,
      sourcefile: 'v1137-context-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    external: ['electron'],
    logLevel: 'silent',
  });
  mod = require(bundlePath);
} catch (err) {
  check('C0-BUNDLE', false, `esbuild of real ipc/api/ctx/catalog/costs failed: ${err?.message ?? err}`);
}

const MODEL_1M_LIVE = 'vendor-x/ultra-1m-v1137';
const MODEL_1M_CURATED = 'anthropic/claude-opus-4-8'; // curated CONTEXT_WINDOWS key => 1,000,000
const MODEL_UNKNOWN = 'never/seen-v1137';

async function main() {
  console.log('===== GUARD C — CONTEXT (real ipc handler + ContextLens chain) =====');
  check('C0-HARNESS', !!mod && typeof mod.ipc.registerIpc === 'function' &&
    typeof mod.api.api?.modelInfo === 'function' && typeof mod.ctx.contextFillPercent === 'function' &&
    typeof mod.catalog.__seedOpenRouterCatalogForTest === 'function' && typeof mod.costs.contextWindowInfo === 'function',
  `real ipc.ts + api.ts + ctx.ts + catalog + costs bundled @ ${loc('electron/ipc.ts', "handle('kdx:model:info'")}`);
  if (!mod) return;

  try {
    mod.ipc.registerIpc({ getMainWindow: () => null });
    globalThis.__v1137.invoke = async (channel, ...args) => {
      const fn = globalThis.__v1137.handlers[channel];
      if (!fn) throw new Error('no ipc handler for ' + channel);
      return fn({}, ...args); // wrapped by handle(): (_event, ...args) => fn(...args)
    };
  } catch (err) {
    check('C0-REGISTER', false, `registerIpc threw: ${err?.message ?? err}`);
    return;
  }
  check('C0-HANDLER', typeof globalThis.__v1137.handlers['kdx:model:info'] === 'function',
    `kdx:model:info really registered @ ${loc('electron/ipc.ts', "handle('kdx:model:info'")}`);

  // ---- 1. inject a 1M model through the REAL OpenRouter catalog fixture ----
  const rows = mod.catalog.parseOpenRouterModels({
    data: [{
      id: MODEL_1M_LIVE,
      name: 'Vendor X: Ultra 1M (v1137 fixture)',
      context_length: 1_000_000,
      pricing: { prompt: '0.000001', completion: '0.000002' },
    }],
  });
  mod.catalog.__seedOpenRouterCatalogForTest(rows, Date.UTC(2026, 10, 22, 0, 0, 0));
  const seeded = mod.catalog.openrouterContextFor(MODEL_1M_LIVE);
  check('C1-CATALOG-1M', seeded === 1_000_000,
    `catalog reports the injected 1M window (got ${seeded}) @ ${loc('electron/services/openrouterCatalog.ts', 'export function __seedOpenRouterCatalogForTest')}`);

  // ---- 2. the real IPC handler + renderer bridge ----
  const raw = await globalThis.__v1137.invoke('kdx:model:info', MODEL_1M_LIVE);
  check('C2-IPH-1M', raw.contextWindow === 1_000_000 && raw.contextWindow !== 200_000,
    `kdx:model:info returns 1,000,000 NOT 200,000 (got ${raw.contextWindow}, estimated=${raw.ctxEstimated}) @ ${loc('electron/ipc.ts', 'const ctx = catalogCtx ?? info.ctx')}`);
  const viaApi = await mod.api.api.modelInfo(MODEL_1M_LIVE);
  check('C2-API-1M', viaApi.contextWindow === 1_000_000 && viaApi.ctxEstimated !== true,
    `api.modelInfo (renderer bridge) carries 1M to the lens (got ${viaApi.contextWindow}) @ ${loc('src/lib/api.ts', 'modelInfo(modelId: string)')}`);

  // ---- 3. reproduce ContextLens' exact state update + occupancy math ----
  const lens = { ctxWindow: 200_000, ctxWindowEstimated: true }; // the stale default the founder saw
  if (viaApi && viaApi.contextWindow > 0) {
    const estimated = viaApi.ctxEstimated === true;
    if (!(!lens.ctxWindowEstimated && mod.ctx.isOneMClassWindow(lens.ctxWindow) && estimated)) {
      lens.ctxWindow = viaApi.contextWindow;
      lens.ctxWindowEstimated = estimated;
    }
  }
  check('C3-LENS-WINDOW', lens.ctxWindow === 1_000_000 && lens.ctxWindow !== 200_000,
    `orb/window state holds 1,000,000, not the 200k default (got ${lens.ctxWindow}) @ ${loc('src/components/ContextLens.tsx', 'st.setCtxWindow(info.contextWindow)')}`);
  const pct = mod.ctx.contextFillPercent(100_000, lens.ctxWindow, lens.ctxWindowEstimated);
  check('C3-OCCUPANCY', pct === 10 && mod.ctx.contextFillPercent(100_000, 200_000, false) === 50,
    `100k of 1M = 10% (would be 50% on 200k) — got ${pct}% @ ${loc('src/lib/ctx.ts', 'export function contextFillPercent(')}`);
  const stamp = mod.ctx.isOneMClassWindow(lens.ctxWindow) ? '1M' : '?';
  check('C3-1M-STAMP', stamp === '1M',
    `confirmed 1M-class window renders the honest "1M" stamp @ ${loc('src/components/ContextLens.tsx', "isOneMClassWindow(ctxWindow) ? '1M'")}`);
  const breakdown = mod.ctx.formatContextBreakdown({
    model: MODEL_1M_LIVE, fill: 100_000, window: lens.ctxWindow,
  });
  check('C3-BREAKDOWN', /1000000/.test(breakdown) && !/200,?000/.test(breakdown),
    `breakdown prints 1,000,000 and never 200,000: ${JSON.stringify(breakdown.split('\n')[0])} @ ${loc('src/lib/ctx.ts', 'export function formatContextBreakdown(')}`);

  // ---- 4. curated fallback for a known 1M model (no live catalog) ----
  mod.catalog.__resetOpenRouterCatalogForTest();
  const curatedRaw = await globalThis.__v1137.invoke('kdx:model:info', MODEL_1M_CURATED);
  check('C4-CURATED-1M', curatedRaw.contextWindow === 1_000_000 && curatedRaw.ctxEstimated === false,
    `curated fallback for ${MODEL_1M_CURATED} is 1M and exact, not 200k (got ${curatedRaw.contextWindow}, estimated=${curatedRaw.ctxEstimated}) @ ${loc('electron/agent/costs.ts', '{ key: \'claude-opus-4-8\', ctx: 1_000_000 }')}`);

  // ---- 5. no false 100% on an unknown / estimated window ----
  const unknown = await globalThis.__v1137.invoke('kdx:model:info', MODEL_UNKNOWN);
  check('C5-UNKNOWN-HONEST', unknown.contextWindow === 200_000 && unknown.ctxEstimated === true,
    `unknown model falls back to ≈200k flagged estimated (got ${unknown.contextWindow}, estimated=${unknown.ctxEstimated})`);
  const noPct = mod.ctx.contextFillPercent(1_200_000, unknown.contextWindow, unknown.ctxEstimated);
  check('C5-NO-FALSE-100', noPct === null,
    `fill beyond an ≈200k window yields NO percentage, never a fabricated 100% (got ${noPct}) @ ${loc('src/lib/ctx.ts', 'if (windowEstimated && f >= ctxWindow) return null;')}`);
  const unknownBreak = mod.ctx.formatContextBreakdown({
    model: MODEL_UNKNOWN, fill: 1_200_000, window: unknown.contextWindow, windowEstimated: true,
  });
  check('C5-BREAKDOWN-HONEST', !/100\s*%/.test(unknownBreak) && /≈/.test(unknownBreak),
    `unknown-window breakdown carries ≈ and no 100%: ${JSON.stringify(unknownBreak.split('\n')[0])}`);

  // ---- 6. a stale 200k answer must not downgrade a confirmed 1M window ----
  const confirmed = { ctxWindow: 1_000_000, ctxWindowEstimated: false };
  const staleInfo = { contextWindow: 200_000, ctxEstimated: true };
  const guard = !confirmed.ctxWindowEstimated &&
    mod.ctx.isOneMClassWindow(confirmed.ctxWindow) && staleInfo.ctxEstimated === true;
  check('C6-NO-DOWNGRADE', guard === true,
    `ContextLens v1137 guard blocks the stale ≈200k downgrade of a confirmed 1M window @ ${loc('src/components/ContextLens.tsx', 'never DOWNGRADE a confirmed 1M-class window')}`);

  // ---- 7. source wiring (the chain really exists in the live tree) ----
  const ipcSrc = src('electron/ipc.ts');
  const lensSrc = src('src/components/ContextLens.tsx');
  check('C7-WIRING-IPC', /const catalogCtx = openrouterContextFor\(id\)/.test(ipcSrc) &&
    /const ctx = catalogCtx \?\? info\.ctx/.test(ipcSrc),
  `handler resolves catalog-first then curated @ ${loc('electron/ipc.ts', 'const catalogCtx = openrouterContextFor(id)')}`);
  check('C7-WIRING-LENS', /api\s*\n?\s*\.modelInfo\(model\.model\)/.test(lensSrc) ||
    /\.modelInfo\(model\.model\)/.test(lensSrc),
  `lens really fetches api.modelInfo(model.model) @ ${loc('src/components/ContextLens.tsx', '.modelInfo(model.model)')}`);

  mod.catalog.__resetOpenRouterCatalogForTest();
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* gone */ }
  console.log(`\n===== GUARD C SUMMARY: ${failures.length ? 'FAIL' : 'PASS'} (${failures.length} failure(s)) =====`);
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = failures.length ? 1 : 0;
  // some captured services keep timers alive — flush and exit explicitly.
  setImmediate(() => process.exit(process.exitCode ?? 0));
}
main().catch((err) => {
  console.error('GUARD C crashed:', err);
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
});
