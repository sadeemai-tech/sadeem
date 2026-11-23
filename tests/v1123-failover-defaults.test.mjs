// ============================================================
// SADEEM v11.23 — FAILOVER DEFAULTS / FRESH-READ REGRESSION
//
// Standing founder demand:
//   "no auto provider switching / failover OFF by default / no noisy 429"
//
// Locks down the invariants across EVERY settings source:
//   1. Fresh install            → allowModelFailover === false
//   2. Migrated settings.json   → false (even if a stale truthy value existed)
//   3. Profile import           → false when absent/malformed (opt-in still honored)
//   4. CLI / headless           → same storeService defaults (no special path)
//   5. router.isFailoverEnabled → reads fresh, NO module-level cache
//   6. failover chain when ON   → bounded + deduped, user model always first
//
// The 429/402/401 engine + provider contracts are covered by the sibling
// suites v1119-429-quiet / v1116-provider-latency / v1110-usage. This suite
// owns the DEFAULT-OFF and FRESH-READ half of the guarantee.
//
// Run:
//   node --test --test-force-exit tests/v1123-failover-defaults.test.mjs
// ============================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1123-failover-'));
const userData = join(tmp, 'userData');
const settingsFile = join(userData, 'settings.json');

function bundle(entry, out, extra = []) {
  execFileSync(
    ESBUILD_NODE,
    [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`, '--log-level=error', ...extra],
    { cwd: ROOT, stdio: 'pipe' },
  );
  return require(out);
}

// router: electron is external (matches v1119-router-gate.test.mjs)
const router = bundle(join(ROOT, 'electron/agent/router.ts'), join(tmp, 'router.cjs'), ['--external:electron']);

// storeService: electron stubbed; userData isolated via env before first call.
process.env.SADEEM_TEST_USERDATA = userData;
const store = bundle(join(ROOT, 'electron/services/storeService.ts'), join(tmp, 'storeService.cjs'), [
  '--alias:electron=./tests/electron-stub.mjs',
]);

// profileService: the import path that writes settings wholesale.
let profileSvc = null;
try {
  profileSvc = bundle(join(ROOT, 'electron/services/profileService.ts'), join(tmp, 'profileService.cjs'), [
    '--alias:electron=./tests/electron-stub.mjs',
  ]);
} catch {
  /* profile import is asserted via saveSettings below when bundling is unavailable */
}

function resetDisk() {
  try { rmSync(userData, { recursive: true, force: true }); } catch { /* best effort */ }
}
function writeRaw(obj) {
  mkdirSync(userData, { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(obj, null, 2), { encoding: 'utf8' });
}
function readRaw() {
  return JSON.parse(readFileSync(settingsFile, 'utf8'));
}
const twoProviders = (extraAgent) => ({
  language: 'en',
  model: { provider: 'anthropic', model: 'claude-sonnet-5.5' },
  providers: {
    anthropic: { apiKey: 'sk-ant' },
    deepseek: { apiKey: 'sk-ds', lastModels: ['deepseek-chat'] },
  },
  agent: { ...(extraAgent ?? {}) },
});
const sessionModel = { provider: 'anthropic', model: 'claude-sonnet-5.5' };

// ============================================================
// 0 · canonical default + normalizer
// ============================================================
test('v1123: canonical default is literal false and the normalizer accepts only true', () => {
  assert.equal(store.DEFAULT_SETTINGS.agent.allowModelFailover, false);
  for (const bad of [undefined, null, false, 'true', '1', 1, 0, {}, []]) {
    assert.equal(store.normalizeAllowModelFailover(bad), false, `non-boolean ${JSON.stringify(bad)} must be OFF`);
  }
  assert.equal(store.normalizeAllowModelFailover(true), true, 'explicit literal true is the only opt-in');
});

// ============================================================
// 1 · FRESH INSTALL
// ============================================================
test('v1123: fresh install (no settings.json) resolves failover OFF', () => {
  resetDisk();
  assert.equal(existsSync(settingsFile), false);
  const s = store.getSettings();
  assert.equal(s.agent.allowModelFailover, false);
  assert.equal(router.isFailoverEnabled(s), false);
  assert.equal(router.failoverChain(s, sessionModel).length, 1, 'no silent alternates on a fresh install');
});

// ============================================================
// 2 · MIGRATED SETTINGS (old schema, missing field, stale truthy value)
// ============================================================
test('v1123: migrated settings with no agent block resolve failover OFF', () => {
  resetDisk();
  writeRaw({ schemaVersion: 2, language: 'en', model: { provider: 'anthropic', model: 'claude-sonnet-4-5' } });
  const s = store.getSettings();
  assert.equal(s.agent.allowModelFailover, false, 'absent after migration => default false');
  assert.equal(router.isFailoverEnabled(s), false);
});

test('v1123: migration canonicalizes a stale truthy flag to false on disk', () => {
  resetDisk();
  writeRaw({ schemaVersion: 2, language: 'en', agent: { allowModelFailover: 'true' } });
  const s = store.getSettings();
  assert.equal(s.agent.allowModelFailover, false, 'string "true" is NOT consent');
  assert.equal(readRaw().agent.allowModelFailover, false, 'migration writes the canonical OFF value');

  // A schema-v4 file skips the migration runner — getSettings still hardens.
  writeRaw({ schemaVersion: 4, language: 'en', agent: { allowModelFailover: 1 } });
  assert.equal(store.getSettings().agent.allowModelFailover, false);
});

// ============================================================
// 3 · PROFILE IMPORT (settings restored wholesale)
// ============================================================
const minimalDNA = {
  version: 1,
  profile: { expertise: [], languages: [], likes: [], dislikes: [], styleNotes: [] },
  patterns: [],
  feedback: [],
  stats: { sessionsObserved: 0, factsRecorded: 0, updatedAt: 0 },
};
const profileOf = (settings) => ({
  format: 'sadeem-profile',
  version: 1,
  exportedAt: new Date().toISOString(),
  appVersion: '11.12.0',
  settings,
  dna: minimalDNA,
  skills: [],
  prompts: [],
});

test('v1123: imported profile without the flag leaves failover OFF', async () => {
  resetDisk();
  const p = profileOf({ language: 'en', model: { provider: 'anthropic', model: 'claude-sonnet-5.5' } });
  if (profileSvc) {
    const r = await profileSvc.importProfile(p);
    assert.equal(r.ok, true, JSON.stringify(r));
  } else {
    store.saveSettings(p.settings); // importProfile writes settings via saveSettings
  }
  assert.equal(store.getSettings().agent.allowModelFailover, false);
});

test('v1123: imported profile with a malformed truthy flag stays OFF', async () => {
  resetDisk();
  const p = profileOf({ language: 'en', agent: { allowModelFailover: 'yes' } });
  if (profileSvc) await profileSvc.importProfile(p);
  else store.saveSettings(p.settings);
  assert.equal(store.getSettings().agent.allowModelFailover, false);
  assert.equal(readRaw().agent.allowModelFailover, false, 'write-time hardening persists OFF');
});

test('v1123: an explicit literal true in an imported profile is still honored', async () => {
  resetDisk();
  const p = profileOf({ language: 'en', agent: { allowModelFailover: true } });
  if (profileSvc) await profileSvc.importProfile(p);
  else store.saveSettings(p.settings);
  assert.equal(store.getSettings().agent.allowModelFailover, true, 'opt-in survives a round-trip');
});

// ============================================================
// 4 · CLI / HEADLESS use the same storeService path
// ============================================================
test('v1123: CLI/headless settings (no renderer default injection) resolve OFF', () => {
  resetDisk();
  // CLI calls runAgent with no settings object; the engine falls back to
  // storeService.getSettings(). Simulate that direct read.
  const s = store.getSettings();
  assert.equal(s.agent?.allowModelFailover ?? false, false);
  assert.equal(router.isFailoverEnabled(s), false);
  // Even a totally absent settings object is safe (engine may consult early).
  assert.equal(router.isFailoverEnabled(), false);
  assert.equal(router.isFailoverEnabled({}), false);
});

// ============================================================
// 5 · FRESH READ — no stale cache in the router gate
// ============================================================
test('v1123: isFailoverEnabled reflects the CURRENT value on every call', () => {
  const s = twoProviders();
  assert.equal(router.isFailoverEnabled(s), false, 'gate OFF by default');
  s.agent.allowModelFailover = true;
  assert.equal(router.isFailoverEnabled(s), true, 'flipping to true is seen immediately (no cached false)');
  s.agent.allowModelFailover = false;
  assert.equal(router.isFailoverEnabled(s), false, 'flipping back to false is seen immediately (no cached true)');
  // Getter form binds to the live value — never a stale snapshot.
  assert.equal(router.isFailoverEnabled(() => s), false);
  s.agent.allowModelFailover = true;
  assert.equal(router.isFailoverEnabled(() => s), true);
});

// ============================================================
// 6 · BOUNDED + DEDUPED chain when the user explicitly opts in
// ============================================================
test('v1123: opt-in chain is bounded (cap alternates) and deduped', () => {
  const s = twoProviders({ allowModelFailover: true });
  for (const id of ['openai', 'gemini', 'zai', 'mistral', 'xai']) {
    s.providers[id] = { apiKey: `sk-${id}`, lastModels: [`${id}-model`] };
  }
  const chain = router.failoverChain(s, sessionModel, 2);
  assert.ok(chain.length >= 2 && chain.length <= 3, `bounded at cap+1 (got ${chain.length})`);
  assert.deepEqual(chain[0], { provider: sessionModel.provider, model: sessionModel.model }, 'user model is entry #0');
  const keys = chain.map((r) => `${r.provider}|${r.model}`);
  assert.equal(new Set(keys).size, keys.length, `no duplicate refs in chain: ${JSON.stringify(chain)}`);
});

test('v1123: gate OFF yields a single-model chain even with many providers', () => {
  const s = twoProviders(); // no opt-in
  for (const id of ['openai', 'gemini', 'zai', 'mistral', 'xai']) s.providers[id] = { apiKey: `sk-${id}` };
  const chain = router.failoverChain(s, sessionModel, 5);
  assert.equal(chain.length, 1, 'no automatic switching regardless of how many providers exist');
});

// ============================================================
// 7 · source contract: the engine gates the chain on the fresh flag
// ============================================================
test('v1123: engine still gates the failover chain on isFailoverEnabled', () => {
  const src = readFileSync(join(ROOT, 'electron/agent/engine.ts'), 'utf8');
  assert.match(src, /isFailoverEnabled\(failoverSettings\)/, 'engine consults the fresh gate');
  assert.match(src, /failoverChain\(failoverSettings, params\.model\)/, 'chain is derived from that same snapshot');
  assert.match(src, /\.filter\(\(r\) => r\.provider !== primaryAttempt\.provider/, 'primary is deduped against the chain');
  assert.match(src, /if \(failoverIdx \+ 1 >= failover\.length\) break;/, 'the failover loop is bounded');
  assert.match(src, /type: 'error', message/, 'one honest error event on terminal failure');
  assert.match(src, /type: 'task_report'/, 'terminal task report is emitted');
  assert.match(src, /type: 'turn_end'/, 'terminal turn_end is emitted');
});

after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});
