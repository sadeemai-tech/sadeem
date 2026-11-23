import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// v11.10 — PROVIDERS + PLANS test suite (Task A8): the three founder
// complaints, exercised against the REAL main-process code:
//
//   1. PROVIDER BUG — "I add an OpenRouter provider and enable it, settings
//      says 'no model configured' even though it's set up":
//      • validation matrix for validateProviderEnable / enableProvider:
//        key + live catalog → ok, NO field errors, honest default model;
//        missing key → FIELD error only (never a global failure);
//        catalog fetch failure → provider still saved (ok:true) with an
//        honest MODEL_LIST_UNAVAILABLE warning + curated fallback models.
//      • default-model policy: OpenRouter prefers a FREE model from a
//        well-known vendor, picked FROM the catalog (never hardcoded ids);
//      • adoption rule: a provider with no usable active model adopts the
//        default; a working setup is never hijacked.
//      The engine-side guard (agent/engine.ts run start) fails only when
//      model.model is empty — the enable flow above guarantees a selected
//      model, which is the actual root-cause fix surface (engine.ts is
//      outside this task's allowed files).
//
//   2. PLANS = EXACTLY TWO TIERS — billingService.PLANS ships Free + Pro
//      only; the Pro price is the ONE editable constant (PRO_PRICE_USD).
//
//   3. DECLUTTER — spacing pass is visual; asserted structurally where
//      cheap (StatusBar chip markup keeps the sb-secondary overflow
//      contract; the duplicate hairline span is gone from StatusBar.tsx).
//
// Self-bootstrapping: bundles electron/services with esbuild (same posture
// as v1110-surface). NO NETWORK — global fetch is monkey-patched per test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1110-providers-plans-'));

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
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: async () => {} },
    Notification: { isSupported: () => false },
  };`,
);

// ---------- bundles ----------
const provPath = join(tmp, 'providers.cjs');
bundle('electron/services/providerService.ts', provPath);
const providers = require(provPath);

const billingPath = join(tmp, 'billing.cjs');
bundle('electron/services/billingService.ts', billingPath);
const billing = require(billingPath);

// ============================================================
// 1 · PROVIDER BUG — validation matrix
// ============================================================
const OPENROUTER_CATALOG = {
  data: [
    { id: 'vendor-x/obscure-1', name: 'Obscure 1', context_length: 8000, pricing: { prompt: '0.001', completion: '0.002' } },
    { id: 'mistral/mistral-large:free', name: 'Mistral Large (free)', context_length: 128000, pricing: { prompt: '0', completion: '0' } },
    { id: 'google/gemini-flash:free', name: 'Gemini Flash (free)', context_length: 1000000, pricing: { prompt: '0', completion: '0' } },
    { id: 'deepseek/deepseek-chat:free', name: 'DeepSeek Chat (free)', context_length: 64000, pricing: { prompt: '0', completion: '0' } },
    { id: 'anthropic/claude-sonnet', name: 'Claude Sonnet', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' } },
    { id: 'qwen/qwen3-max:free', name: 'Qwen3 Max (free)', context_length: 32000, pricing: { prompt: '0', completion: '0' } },
  ],
};

/** Patch global fetch for the duration of `fn` (scripted per URL fragment). */
async function withFetch(scripted, fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const key = String(url);
    const route = [...scripted.keys()].find((frag) => key.includes(frag));
    const handler = route ? scripted.get(route) : null;
    if (!handler) throw new Error(`UNSCRIPTED fetch: ${key}`);
    return handler(key, init);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('A8 · provider enable — key + live catalog → ok, no field errors, free well-known default', async () => {
  const scripted = new Map([
    ['openrouter.ai/api/v1/models', async () =>
      new Response(JSON.stringify(OPENROUTER_CATALOG), { status: 200, headers: { 'content-type': 'application/json' } })],
  ]);
  await withFetch(scripted, async () => {
    const res = await providers.enableProvider('openrouter', {
      apiKey: 'sk-or-test',
      active: { provider: 'anthropic', model: 'claude-sonnet-5.5', hasKey: false },
    });
    assert.equal(res.ok, true, 'enable must succeed');
    assert.equal(res.fieldErrors, undefined, 'no field errors with a key');
    assert.equal(res.error, undefined, 'no global error');
    assert.ok(res.models.length >= 5, 'live catalog rows flow through');
    // default-model policy: FREE first, well-known vendor order
    // (deepseek beats google/mistral/qwen), picked FROM the catalog
    assert.equal(res.defaultModel, 'deepseek/deepseek-chat:free');
    // adoption: active provider (anthropic) has NO key → adopt the default
    assert.equal(res.adopt, true);
  });
});

test('A8 · provider enable — missing key → FIELD error only, never a global failure', async () => {
  const res = await providers.enableProvider('openrouter', {});
  assert.equal(res.ok, false);
  assert.equal(res.fieldErrors?.apiKey, 'MISSING_KEY');
  assert.equal(res.error, undefined, 'missing credentials are a FIELD error, not a global one');
  // pure validator agrees
  const v = providers.validateProviderEnable('openrouter', {}, { keyless: false });
  assert.equal(v.ok, false);
  assert.equal(v.fieldErrors?.apiKey, 'MISSING_KEY');
});

test('A8 · provider enable — keyless provider (ollama) enables with no key', async () => {
  const scripted = new Map([
    ['localhost:11434', async () =>
      new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }), { status: 200, headers: { 'content-type': 'application/json' } })],
  ]);
  await withFetch(scripted, async () => {
    const res = await providers.enableProvider('ollama', {});
    assert.equal(res.ok, true);
    assert.equal(res.fieldErrors, undefined);
    assert.deepEqual(res.models, ['qwen2.5-coder:7b']);
    assert.equal(res.defaultModel, 'qwen2.5-coder:7b');
  });
});

test('A8 · provider enable — custom provider without baseUrl → field-level baseUrl error', () => {
  const res = providers.validateProviderEnable('custom', { apiKey: 'k' }, { keyless: false });
  assert.equal(res.ok, false);
  assert.equal(res.fieldErrors?.baseUrl, 'MISSING_BASE_URL');
});

test('A8 · provider enable — catalog fetch failure → saved (ok) with honest warning + curated fallback', async () => {
  const scripted = new Map([
    ['openrouter.ai', async () => { throw new Error('ECONNREFUSED (test)'); }],
  ]);
  await withFetch(scripted, async () => {
    const res = await providers.enableProvider('openrouter', {
      // a DIFFERENT key than the success test: the live-catalog cache is
      // per-key (10-min TTL) — a fresh key forces a real (failing) fetch.
      apiKey: 'sk-or-offline',
      active: { provider: 'openrouter', model: '', hasKey: true },
      // the renderer passes its curated presets through (never hardcoded here)
      curatedModels: [
        'anthropic/claude-opus-5.5',
        'openai/gpt-6-astra',
        'deepseek/deepseek-chat',
        'z-ai/glm-5.3',
      ],
    });
    assert.equal(res.ok, true, 'provider must STILL be enabled — fetch failure is not a validation failure');
    assert.ok(res.warning?.startsWith('MODEL_LIST_UNAVAILABLE'), `honest warning present, got: ${res.warning}`);
    assert.ok(res.models.length > 0, 'curated preset models are the visible fallback');
    assert.equal(res.defaultModel, 'deepseek/deepseek-chat', 'curated fallback still yields a sensible default');
  });
});

test('A8 · provider enable — a working model choice is never hijacked', async () => {
  const scripted = new Map([
    ['openrouter.ai/api/v1/models', async () =>
      new Response(JSON.stringify(OPENROUTER_CATALOG), { status: 200, headers: { 'content-type': 'application/json' } })],
  ]);
  await withFetch(scripted, async () => {
    const res = await providers.enableProvider('openrouter', {
      apiKey: 'sk-or-test',
      active: { provider: 'openrouter', model: 'anthropic/claude-sonnet', hasKey: true },
    });
    assert.equal(res.ok, true);
    assert.equal(res.adopt, false, 'valid active model on the same provider → keep it');
    assert.equal(res.defaultModel, 'deepseek/deepseek-chat:free');
  });
});

test('A8 · adoption rule matrix (pure)', () => {
  const models = ['a/one', 'b/two'];
  assert.equal(providers.shouldAdoptDefault('openrouter', models, undefined), true, 'no active model → adopt');
  assert.equal(providers.shouldAdoptDefault('openrouter', models, { provider: 'openrouter', model: '' }), true, 'empty model → adopt');
  assert.equal(providers.shouldAdoptDefault('openrouter', models, { provider: 'openrouter', model: 'nope' }), true, 'invalid model on same provider → adopt');
  assert.equal(providers.shouldAdoptDefault('openrouter', models, { provider: 'openrouter', model: 'a/one' }), false, 'valid model on same provider → keep');
  assert.equal(providers.shouldAdoptDefault('openrouter', models, { provider: 'anthropic', model: 'claude', hasKey: true }), false, 'other provider with key → keep');
  assert.equal(providers.shouldAdoptDefault('openrouter', models, { provider: 'anthropic', model: 'claude', hasKey: false }), true, 'other provider without key → adopt');
});

test('A8 · pickDefaultModel — free well-known vendor wins; sane fallbacks', () => {
  // deepseek beats google/mistral/qwen in the well-known order
  assert.equal(providers.pickDefaultModel('openrouter', ['google/x:free', 'deepseek/d:free', 'mistral/m:free']), 'deepseek/d:free');
  // no well-known free → any free
  assert.equal(providers.pickDefaultModel('openrouter', ['vendor-a/a:free', 'vendor-b/b:free']), 'vendor-a/a:free');
  // no free at all → well-known vendor non-free
  assert.equal(providers.pickDefaultModel('openrouter', ['vendor-a/a', 'qwen/q']), 'qwen/q');
  // nothing known → first row (from the catalog, never an invented id)
  assert.equal(providers.pickDefaultModel('openrouter', ['vendor-x/x', 'vendor-y/y']), 'vendor-x/x');
  // non-openrouter providers take the newest first row
  assert.equal(providers.pickDefaultModel('deepseek', ['deepseek-chat', 'deepseek-reasoner']), 'deepseek-chat');
  assert.equal(providers.pickDefaultModel('openrouter', []), undefined);
});

// ============================================================
// 2 · PLANS = EXACTLY TWO TIERS
// ============================================================
test('A8 · plan catalog ships EXACTLY Free + Pro', () => {
  assert.equal(billing.PLANS.length, 2, 'exactly two tiers — the Team card is gone');
  assert.deepEqual(billing.PLANS.map((p) => p.id).sort(), ['free', 'pro']);
  const pro = billing.PLANS.find((p) => p.id === 'pro');
  const free = billing.PLANS.find((p) => p.id === 'free');
  assert.equal(pro.priceUsd, billing.PRO_PRICE_USD, 'Pro price reads the ONE editable constant');
  assert.equal(typeof billing.PRO_PRICE_USD, 'number');
  // Free honest limits: BYO keys + local features + community
  const freeCopy = (free.blurb + ' ' + free.features.join(' ')).toLowerCase();
  assert.ok(freeCopy.includes('key'), 'Free copy mentions bringing your own keys');
  assert.ok(freeCopy.includes('local'), 'Free copy mentions local features');
  assert.ok(freeCopy.includes('community'), 'Free copy mentions community support');
  // Pro stays honestly paused under FREE_SEASON (no fake payment flow)
  assert.equal(billing.FREE_SEASON, true);
  assert.equal(pro.available, false, 'Pro is paused while the gateway is offline');
});

test('A8 · billing overview exposes exactly two plans; checkGate free-season is open', () => {
  const ov = billing.overview();
  assert.equal(ov.plans.length, 2);
  assert.deepEqual(ov.plans.map((p) => p.id).sort(), ['free', 'pro']);
  const pro = ov.plans.find((p) => p.id === 'pro');
  assert.equal(pro.priceUsd, billing.PRO_PRICE_USD);
  assert.equal(pro.available, false);
  for (const action of ['run', 'mcp', 'device', 'parallel', 'subagent']) {
    assert.deepEqual(billing.checkGate(action), { allowed: true }, `free season allows ${action}`);
  }
});

// ============================================================
// 3 · DECLUTTER — structural checks (visual pass is human-verified)
// ============================================================
test('A8 · StatusBar duplicate hairline removed; overflow contract kept', () => {
  const sb = readFileSync(join(ROOT, 'src/components/StatusBar.tsx'), 'utf8');
  assert.ok(!sb.includes('flat top hairline'), 'the duplicate absolute hairline span was removed (borderTop already paints it)');
  assert.ok(sb.includes('sb-secondary'), 'the .sb-secondary overflow contract chips survive');
  assert.ok(sb.includes('px-4 py-1'), 'de-density notch: px-3 → px-4');
});

test('A8 · PlansScreen has NO monthly subscription tier grid (founder decision)', () => {
  const ps = readFileSync(join(ROOT, 'src/components/PlansScreen.tsx'), 'utf8');
  // The founder removed every monthly plan. No tier grid, no "coming soon" CTA,
  // no per-month pricing. Only a free-season statement + local license panel.
  assert.ok(!ps.includes('md:grid-cols-2'), 'no two-column monthly tier grid');
  assert.ok(!ps.includes('plans.pro.soon'), 'no coming-soon subscription CTA');
  const noComments = ps.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\$\d+\s*\/\s*mo|\/\s*month|per month/i.test(noComments), 'no monthly price copy in live code');
  assert.ok(/[Ff]ree [Ss]eason|free during the public|مجاني/.test(ps), 'honest free-season statement is present');
});
