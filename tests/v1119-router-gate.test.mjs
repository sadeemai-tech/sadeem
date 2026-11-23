// ============================================================
// SADEEM v11.19 — MODEL ROUTER GATE REGRESSION TESTS
//
// Founder complaint: "بصير يبدل المزودين لحاله" — the app switches
// providers on its own when the FIRST one is merely slow, instead of
// handling the cause. These tests exercise the REAL router.ts and lock
// the fix in place:
//
//   1. A single configured provider yields a chain of length 1 (no
//      silent alternates) — and entry #0 is always the user's model.
//   2. With two configured providers, failover is OFF by default
//      (settings.agent.allowModelFailover absent/false ⇒ chain length 1).
//   3. Explicit opt-in (allowModelFailover: true) enables cross-provider
//      alternates, with the user's model STILL first.
//
// Posture: esbuild bundle of electron/agent/router.ts — same harness as
// v1116-provider-latency.test.mjs. No network, no electron, no DOM.
//
// Run:
//   node --test --test-force-exit tests/v1119-router-gate.test.mjs
// ============================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1119-router-'));

function bundle(entry, out) {
  execFileSync(
    ESBUILD_NODE,
    [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`, '--external:electron'],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

const routerPath = join(tmp, 'router.cjs');
bundle(join(ROOT, 'electron/agent/router.ts'), routerPath);
const router = require(routerPath);

const sessionModel = { provider: 'deepseek', model: 'deepseek-chat' };

/** Build a minimal AppSettings-shaped object with N credentialed providers. */
function settings({ providerIds = ['deepseek'], allowModelFailover, lastModels = {} } = {}) {
  const providers = {};
  for (const id of providerIds) {
    providers[id] = {
      apiKey: `sk-${id}`,
      ...(lastModels[id] ? { lastModels: lastModels[id] } : {}),
    };
  }
  const agent = {};
  if (allowModelFailover !== undefined) agent.allowModelFailover = allowModelFailover;
  return { language: 'en', model: { ...sessionModel }, providers, agent };
}

// ============================================================
// 1 · SINGLE CONFIGURED PROVIDER ⇒ chain length 1, user's model first
// ============================================================
test('v1119: single configured provider => failover chain length 1 (no silent alternates)', () => {
  const s = settings({ providerIds: ['deepseek'] });
  const chain = router.failoverChain(s, sessionModel);

  assert.equal(chain.length, 1, 'FAILING BEFORE FIX: a lone provider must never produce an alternate');
  assert.deepEqual(
    chain[0],
    { provider: sessionModel.provider, model: sessionModel.model },
    'entry #0 is ALWAYS the user-chosen active model',
  );
  assert.ok(chain.every((r) => r.provider === sessionModel.provider), 'no different provider appears anywhere');
});

// ============================================================
// 2 · TWO PROVIDERS, GATE OFF (DEFAULT) ⇒ still length 1
// ============================================================
test('v1119: two providers but failover disabled by default => chain length 1', () => {
  // allowModelFailover is ABSENT — the default must be FALSE.
  const s = settings({
    providerIds: ['deepseek', 'anthropic'],
    lastModels: { anthropic: ['claude-sonnet-4-5'] },
  });
  assert.equal(router.isFailoverEnabled(s), false, 'gate defaults to FALSE when setting is absent');

  const chain = router.failoverChain(s, sessionModel);
  assert.equal(chain.length, 1, 'FAILING BEFORE FIX: silent cross-provider switch when first provider is slow');
  assert.deepEqual(chain[0], { provider: sessionModel.provider, model: sessionModel.model });
  assert.ok(chain.every((r) => r.provider === sessionModel.provider), 'the second provider is NOT introduced');

  // explicit false behaves the same as absent
  const sFalse = settings({ providerIds: ['deepseek', 'anthropic'], allowModelFailover: false });
  assert.equal(router.isFailoverEnabled(sFalse), false);
  assert.equal(router.failoverChain(sFalse, sessionModel).length, 1);
});

// ============================================================
// 3 · EXPLICIT OPT-IN ⇒ cross-provider alternates enabled, user first
// ============================================================
test('v1119: explicit allowModelFailover=true enables cross-provider failover (user model stays first)', () => {
  const s = settings({
    providerIds: ['deepseek', 'anthropic'],
    allowModelFailover: true,
    lastModels: { anthropic: ['claude-sonnet-4-5'] },
  });
  assert.equal(router.isFailoverEnabled(s), true);

  const chain = router.failoverChain(s, sessionModel);
  assert.ok(chain.length > 1, 'opt-in must actually enable the alternate provider');
  assert.deepEqual(chain[0], { provider: sessionModel.provider, model: sessionModel.model }, 'user model is STILL first');
  assert.ok(
    chain.slice(1).some((r) => r.provider === 'anthropic'),
    'the explicitly configured second provider appears as an alternate',
  );

  // isFailoverEnabled is safe with no / partial settings (engine consults it early)
  assert.equal(router.isFailoverEnabled(), false);
  assert.equal(router.isFailoverEnabled({}), false);
  assert.equal(router.isFailoverEnabled({ agent: { allowModelFailover: 'yes' } }), false, 'non-boolean => false');
});

// ============================================================
// 4 · VERIFIER never swaps the user's model by itself
// ============================================================
test('v1119: pickVerifier keeps the worker model unless multi-provider + opt-in', () => {
  const worker = { ...sessionModel };

  // single provider → same model, honest degrade
  const sSingle = settings({ providerIds: ['deepseek'] });
  const v1 = router.pickVerifier(sSingle, worker);
  assert.deepEqual(v1.model, worker, 'single provider => verifier keeps the user model');
  assert.match(v1.reason, /degraded/);

  // two providers but gate off → still the user model
  const sOff = settings({ providerIds: ['deepseek', 'anthropic'], lastModels: { anthropic: ['claude-sonnet-4-5'] } });
  const v2 = router.pickVerifier(sOff, worker);
  assert.deepEqual(v2.model, worker, 'gate off => no silent cross-family verifier switch');

  // explicit opt-in → a different-family verifier is chosen
  const sOn = settings({
    providerIds: ['deepseek', 'anthropic'],
    allowModelFailover: true,
    lastModels: { anthropic: ['claude-sonnet-4-5'] },
  });
  const v3 = router.pickVerifier(sOn, worker);
  assert.equal(v3.model.provider, 'anthropic', 'opt-in enables the cross-family verifier for explicit review runs');
});

after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});
