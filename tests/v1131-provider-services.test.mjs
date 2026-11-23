// v11.31 — PROVIDER SERVICES + MODEL CATALOG audit suite.
// Exercises the REAL three main-process services with esbuild bundles and
// ZERO network: provider discovery uses a scripted global fetch, the live
// OpenRouter catalog uses the same, and aiService is bundled with its two
// heavyweight collaborators replaced by tiny stubs so credential resolution
// can be observed directly.
//
// Defects pinned here:
//  • aiComplete borrowing ANTHROPIC_API_KEY for a DeepSeek/Z.ai request
//    (credential leak to the wrong provider) and refusing keyless Ollama;
//  • one-shot completions dropping the usage hook (rate/usage accounting);
//  • catalog staleness (no forced refresh) and failed refresh discarding the
//    last good provider-reported context window;
//  • a single junk row / numeric id aborting an entire model listing;
//  • list URLs growing a duplicate /v1 (or missing it on a bare host);
//  • raw keys echoed from provider error bodies into settings warnings;
//  • placeholder / CRLF keys accepted as valid;
//  • default-model pick trusting a `:free` suffix over reported pricing.
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
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
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1131-'));

function bundle(entry, out, extra = []) {
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
      '--log-level=error',
      ...extra,
    ],
    { cwd: ROOT, stdio: 'pipe', timeout: 120000 },
  );
}

// ---------- real catalog + provider service ----------
const catalogPath = join(tmp, 'catalog.cjs');
bundle('electron/services/openrouterCatalog.ts', catalogPath);
const catalog = require(catalogPath);

const provPath = join(tmp, 'providers.cjs');
bundle('electron/services/providerService.ts', provPath);
const ps = require(provPath);

// ---------- aiService with stubbed collaborators ----------
// ai.cjs lives in tmp/unit, so its external requires resolve to
//   ../agent/providers → tmp/agent/providers.js
//   ./storeService    → tmp/unit/storeService.js
const unitDir = join(tmp, 'unit');
mkdirSync(unitDir, { recursive: true });
const aiPath = join(unitDir, 'ai.cjs');
bundle('electron/services/aiService.ts', aiPath, [
  '--external:../agent/providers',
  '--external:./storeService',
]);
mkdirSync(join(tmp, 'agent'), { recursive: true });
writeFileSync(
  join(tmp, 'agent', 'providers.js'),
  `module.exports = {
    streamTurn: async (a) => {
      const t = global.__AI_TEST__;
      t.calls.push({ apiKey: a.apiKey, baseUrl: a.baseUrl, model: a.model, hasUsageHook: !!a.onUsage });
      if (t.throwMessage) throw new Error(t.throwMessage);
      a.onText('stubbed');
      a.onUsage?.({ inputTokens: 7, outputTokens: 3, costUsd: 0 });
      return { stopReason: 'end_turn' };
    },
  };`,
);
writeFileSync(
  join(unitDir, 'storeService.js'),
  `module.exports = { getSettings: () => global.__AI_TEST__.settings };`,
);
const ai = require(aiPath);

const ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY',
  'ZAI_API_KEY', 'DEEPSEEK_API_KEY', 'XAI_API_KEY', 'MOONSHOT_API_KEY',
  'QWEN_API_KEY', 'MISTRAL_API_KEY',
];

function seedAi(settings) {
  global.__AI_TEST__ = { settings, calls: [], throwMessage: null };
  return global.__AI_TEST__;
}

async function withEnv(vars, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of ENV_KEYS) {
      if (vars[k] === undefined) delete process.env[k];
      else process.env[k] = vars[k];
    }
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

// ============================================================
// 1 · aiService credential resolution (BYOK honesty + no key leaks)
// ============================================================
test('v1131 · aiComplete uses the ACTIVE provider\'s own env key, never another provider\'s', async () => {
  await withEnv(
    { ANTHROPIC_API_KEY: 'sk-ant-LEAK', OPENAI_API_KEY: 'sk-openai-LEAK', DEEPSEEK_API_KEY: 'sk-ds-correct' },
    async () => {
      const t = seedAi({ model: { provider: 'deepseek', model: 'deepseek-chat' }, providers: {} });
      const res = await ai.aiComplete({ prompt: 'hi' });
      assert.equal(res.ok, true, 'stub stream succeeded');
      assert.equal(t.calls.length, 1);
      assert.equal(t.calls[0].apiKey, 'sk-ds-correct');
      assert.notEqual(t.calls[0].apiKey, 'sk-ant-LEAK', 'FAILING BEFORE FIX: Anthropic key sent to DeepSeek');
      assert.equal(t.calls[0].model.provider, 'deepseek');
    },
  );
});

test('v1131 · an explicit model override also gets ITS provider\'s key only', async () => {
  await withEnv({ ANTHROPIC_API_KEY: 'sk-ant-LEAK', ZAI_API_KEY: 'sk-zai-correct' }, async () => {
    const t = seedAi({ model: { provider: 'anthropic', model: 'claude-x' }, providers: {} });
    const res = await ai.aiComplete({ prompt: 'hi', model: { provider: 'zai', model: 'glm-5.3' } });
    assert.equal(res.ok, true);
    assert.equal(t.calls[0].apiKey, 'sk-zai-correct');
    assert.equal(t.calls[0].model.provider, 'zai');
  });
});

test('v1131 · keyless Ollama completes with NO key and its own base URL (local BYOK)', async () => {
  await withEnv({ ANTHROPIC_API_KEY: 'sk-ant-LEAK', OPENAI_API_KEY: 'sk-openai-LEAK' }, async () => {
    const t = seedAi({ model: { provider: 'ollama', model: 'qwen3-coder' }, providers: {} });
    const res = await ai.aiComplete({ prompt: 'hi' });
    assert.equal(res.ok, true, 'FAILING BEFORE FIX: keyless Ollama reported no_api_key');
    assert.equal(t.calls[0].apiKey, undefined, 'no borrowed key goes to a local model');
    assert.equal(t.calls[0].baseUrl, 'http://localhost:11434/v1');
  });
});

test('v1131 · custom endpoint uses its configured key + URL; a bare custom config is refused', async () => {
  await withEnv({}, async () => {
    const t = seedAi({
      model: { provider: 'custom', model: 'local-model' },
      providers: { custom: { apiKey: 'sk-custom', baseUrl: 'http://127.0.0.1:1234/v1' } },
    });
    assert.equal((await ai.aiComplete({ prompt: 'hi' })).ok, true);
    assert.equal(t.calls[0].apiKey, 'sk-custom');
    assert.equal(t.calls[0].baseUrl, 'http://127.0.0.1:1234/v1');

    seedAi({ model: { provider: 'custom', model: 'local-model' }, providers: { custom: { apiKey: 'sk-custom' } } });
    const bad = await ai.aiComplete({ prompt: 'hi' });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /^no_base_url:/);
  });
});

test('v1131 · missing key/model errors are honest BYOK guidance, never "credits included"', async () => {
  await withEnv({}, async () => {
    seedAi({ model: { provider: 'openai', model: 'gpt-x' }, providers: {} });
    const noKey = await ai.aiComplete({ prompt: 'hi' });
    assert.equal(noKey.ok, false);
    assert.match(noKey.error, /^no_api_key:/);
    assert.match(noKey.error, /YOUR API key \(BYOK\)/);
    assert.doesNotMatch(noKey.error, /credit|free quota|included tokens/i);

    seedAi({ model: { provider: 'openai', model: '' }, providers: {} });
    const noModel = await ai.aiComplete({ prompt: 'hi' });
    assert.equal(noModel.ok, false);
    assert.match(noModel.error, /^no_model:/);
  });
});

test('v1131 · one-shot completions forward the usage hook for rate/usage accounting', async () => {
  await withEnv({ OPENAI_API_KEY: 'sk-openai-usage' }, async () => {
    seedAi({ model: { provider: 'openai', model: 'gpt-x' }, providers: {} });
    let seen = null;
    const res = await ai.aiComplete({ prompt: 'hi', onUsage: (u) => { seen = u; } });
    assert.equal(res.ok, true);
    assert.equal(global.__AI_TEST__.calls[0].hasUsageHook, true, 'FAILING BEFORE FIX: usage was dropped');
    assert.deepEqual(seen, { inputTokens: 7, outputTokens: 3, costUsd: 0 });
  });
});

test('v1131 · provider error text never leaks the key back through aiComplete', async () => {
  await withEnv({ DEEPSEEK_API_KEY: 'sk-ds-secret-4242' }, async () => {
    const t = seedAi({ model: { provider: 'deepseek', model: 'deepseek-chat' }, providers: {} });
    t.throwMessage = 'upstream said: Bearer sk-ds-secret-4242 rejected';
    const res = await ai.aiComplete({ prompt: 'hi' });
    assert.equal(res.ok, false);
    assert.doesNotMatch(res.error, /sk-ds-secret-4242/);
    assert.match(res.error, /\[REDACTED\]/);
  });
});

// ============================================================
// 2 · OpenRouter live catalog: staleness, failure, honest flags
// ============================================================
test('v1131 · catalog force-refresh bypasses TTL; a failed refresh keeps the last good list', async () => {
  let n = 0;
  await withFetch(
    async () => {
      n++;
      if (n === 3) throw new Error('ECONNREFUSED (test)');
      return jsonResponse({ data: [{
        id: 'v/a', name: 'A', context_length: '8192',
        pricing: { prompt: '0', completion: '0' },
        architecture: { input_modalities: ['IMAGE', 'text'] },
      }] });
    },
    async () => {
      const key = 'sk-or-v1131-a';
      const rows = await catalog.openrouterLiveModels(key);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].ctx, 8192, 'string context_length coerced');
      assert.equal(rows[0].free, true);
      assert.equal(rows[0].vision, true, 'case-insensitive image modality');
      await catalog.openrouterLiveModels(key);
      assert.equal(n, 1, 'warm cache serves the picker');
      await catalog.openrouterLiveModels(key, { force: true });
      assert.equal(n, 2, 'force bypasses the TTL');
      assert.deepEqual(await catalog.openrouterLiveModels(key, { force: true }), [], 'never throws');
      assert.equal(n, 3);
      assert.equal(catalog.cachedOpenRouterModels().length, 1, 'last good catalog survives a failed refresh');
      assert.equal(catalog.openrouterContextFor('v/a'), 8192, 'exact provider window still available');
      const info = catalog.cachedOpenRouterCatalogInfo();
      assert.equal(info.count, 1);
      assert.notEqual(info.keyFingerprint, key, 'raw key is not retained in module state');
      assert.equal(typeof info.stale, 'boolean');
    },
  );
});

test('v1131 · free flag trusts reported pricing; :free is only a fallback convention', async () => {
  await withFetch(
    async () => jsonResponse({ data: [
      { id: 'x/paid:free', pricing: { prompt: '0.001', completion: '0.002' } },
      { id: 'x/unpriced:free' },
      { id: 'x/zero', pricing: { prompt: 0, completion: 0 } },
    ] }),
    async () => {
      const rows = await catalog.openrouterLiveModels('sk-or-v1131-b');
      const by = Object.fromEntries(rows.map((r) => [r.id, r]));
      assert.equal(by['x/paid:free'].free, false, 'a priced model is not called free');
      assert.equal(by['x/unpriced:free'].free, true, 'id convention fills in when prices are absent');
      assert.equal(by['x/zero'].free, true);
    },
  );
});

// ============================================================
// 3 · providerService discovery, URLs, validation, redaction
// ============================================================
test('v1131 · listModels tolerates junk rows, numeric ids and string metadata', async () => {
  await withFetch(
    async () => jsonResponse({ data: [
      null,
      { id: 123, created: '2026-01-01T00:00:00Z', context_length: '128000' },
      { name: 'alias-model', display_name: 'Alias', created: 1700000000 },
      { model: 'fallback-id' },
    ] }),
    async () => {
      const res = await ps.listModels('openai', { apiKey: 'sk-x' });
      assert.equal(res.ok, true, 'FAILING BEFORE FIX: one null row sank the whole fetch');
      assert.deepEqual(res.models.map((m) => m.id), ['123', 'alias-model', 'fallback-id']);
      assert.equal(res.models[0].context, 128000);
      assert.ok(res.models[0].created > 0);
      assert.equal(res.models[1].label, 'Alias');
    },
  );
});

test('v1131 · Anthropic listing never doubles /v1 (explicit /v1 override)', async () => {
  await withFetch(
    async (url) => {
      assert.equal(url, 'https://api.anthropic.com/v1/models?limit=1000');
      return jsonResponse({ data: [{ id: 'claude-x' }] });
    },
    async (calls) => {
      const res = await ps.listModels('anthropic', { apiKey: 'sk-ant', baseUrl: 'https://api.anthropic.com/v1' });
      assert.equal(res.ok, true);
      assert.equal(calls.length, 1);
      assert.deepEqual(res.models.map((m) => m.id), ['claude-x']);
    },
  );
});

test('v1131 · a bare custom host gets /v1/models instead of a root /models', async () => {
  await withFetch(
    async (url) => {
      assert.equal(url, 'http://127.0.0.1:5555/v1/models');
      return jsonResponse({ data: [{ id: 'local-model' }] });
    },
    async () => {
      const res = await ps.listModels('custom', { baseUrl: 'http://127.0.0.1:5555' });
      assert.equal(res.ok, true);
      assert.deepEqual(res.models.map((m) => m.id), ['local-model']);
    },
  );
});

test('v1131 · custom endpoint falls back to the Anthropic wire format and redacts echoed keys', async () => {
  const SECRET = 'sk-custom-secret-9988';
  await withFetch(
    async (url) => {
      if (url.endsWith('/v1/models')) return jsonResponse({ error: 'bad key ' + SECRET }, 401);
      if (url.includes('/v1/models?limit=1000')) return jsonResponse({ data: [{ id: 'anthropic-compatible' }] });
      throw new Error('UNSCRIPTED ' + url);
    },
    async () => {
      const res = await ps.listModels('custom', { apiKey: SECRET, baseUrl: 'http://127.0.0.1:5556/v1' });
      assert.equal(res.ok, true, 'FAILING BEFORE FIX: a 404/401 never tried the other protocol');
      assert.deepEqual(res.models.map((m) => m.id), ['anthropic-compatible']);
    },
  );
  await withFetch(
    async (url) => jsonResponse({ error: `rejected ${SECRET} on ${url}` }, 401),
    async () => {
      const res = await ps.listModels('custom', { apiKey: SECRET, baseUrl: 'http://127.0.0.1:5556/v1' });
      assert.equal(res.ok, false);
      assert.doesNotMatch(res.error, /sk-custom-secret-9988/, 'the key never reaches a warning/log');
      assert.match(res.error, /\[REDACTED\]/);
    },
  );
});

test('v1131 · key validation rejects placeholders and CRLF header injection', () => {
  assert.equal(ps.validateProviderEnable('deepseek', { apiKey: 'YOUR_API_KEY' }, { keyless: false }).fieldErrors.apiKey, 'INVALID_KEY');
  assert.equal(ps.validateProviderEnable('deepseek', { apiKey: 'sk\r\nX-Injected: 1' }, { keyless: false }).fieldErrors.apiKey, 'INVALID_KEY');
  assert.equal(ps.validateProviderEnable('openrouter', { apiKey: 'sk-or-real' }, { keyless: false }).ok, true);
  assert.equal(ps.validateProviderEnable('ollama', {}, { keyless: true }).ok, true);
  assert.equal(ps.validateProviderEnable('custom', { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'change-me' }, { keyless: false }).fieldErrors.apiKey, 'INVALID_KEY');
});

test('v1131 · provider env-key map is per-provider; custom/ollama have no borrowed key', () => {
  assert.equal(ps.providerEnvKey('deepseek'), 'DEEPSEEK_API_KEY');
  assert.equal(ps.providerEnvKey('openrouter'), 'OPENROUTER_API_KEY');
  assert.equal(ps.providerEnvKey('custom'), undefined);
  assert.equal(ps.providerEnvKey('ollama'), undefined);
  assert.equal(ps.isKeylessProvider('ollama'), true);
  assert.equal(ps.isKeylessProvider('openai'), false);
});

test('v1131 · enable refreshes on demand and trusts catalog pricing over a :free suffix', async () => {
  const CATALOG = { data: [
    { id: 'google/zero-cost', pricing: { prompt: '0', completion: '0' }, context_length: 1000 },
    { id: 'deepseek/paid:free', pricing: { prompt: '0.001', completion: '0.002' } },
  ] };
  await withFetch(async () => jsonResponse(CATALOG), async (calls) => {
    const key = 'sk-or-v1131-c';
    const r1 = await ps.enableProvider('openrouter', {
      apiKey: key,
      active: { provider: 'openrouter', model: '', hasKey: true },
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.defaultModel, 'google/zero-cost', 'FAILING BEFORE FIX: priced :free id won the vendor priority');
    const before = calls.length;
    await ps.enableProvider('openrouter', { apiKey: key, refresh: false });
    assert.equal(calls.length, before, 'refresh:false reuses the warm catalog');
    await ps.enableProvider('openrouter', { apiKey: key, refresh: true });
    assert.equal(calls.length, before + 1, 'refresh:true fetches a fresh catalog');
  });
});

test('v1131 · enable failure stays ok:true with an honest, redacted warning + curated fallback', async () => {
  const SECRET = 'sk-or-v1131-offline-7777';
  await withFetch(async () => { throw new Error('ECONNREFUSED ' + SECRET); }, async () => {
    const res = await ps.enableProvider('openrouter', {
      apiKey: SECRET,
      active: { provider: 'openrouter', model: '', hasKey: true },
      curatedModels: ['openai/gpt-x', 'deepseek/deepseek-chat'],
    });
    assert.equal(res.ok, true);
    assert.match(res.warning ?? '', /^MODEL_LIST_UNAVAILABLE/);
    assert.doesNotMatch(res.warning ?? '', /sk-or-v1131-offline-7777/);
    assert.deepEqual(res.models, ['openai/gpt-x', 'deepseek/deepseek-chat']);
    assert.equal(res.defaultModel, 'deepseek/deepseek-chat');
  });
});

test('v1131 · structural: main-process base URLs match the renderer presets (no drift)', () => {
  const extract = (src) => [...src.matchAll(/baseUrl:\s*'([^']*)'/g)].map((m) => m[1]).sort();
  const main = extract(readFileSync(join(ROOT, 'electron/services/providerService.ts'), 'utf8'));
  const renderer = extract(readFileSync(join(ROOT, 'src/store.ts'), 'utf8'));
  assert.deepEqual(main, renderer, 'a preset URL edited in only one place is a wrong-base-URL bug');
});

test('cleanup', () => {
  delete global.__AI_TEST__;
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});
