// v11.33 — LICENSE ENTITLEMENT TRUTH (offline, real services, no network)
// ============================================================
// Driven against the REAL electron/services TypeScript sources (esbuild
// bundles, isolated userData, mocked clock) plus the REAL scripts/license-gen.cjs.
//
// Covers:
//   • the founder CLI mints legacy-secret keys that verify cross-device
//   • OWNER / FOUNDER keys → 'pro' entitlement, honest label, NO expiry
//   • redeemLicense() stores the verified key 0600 and returns a real
//     entitlement; bad keys throw ONE clear sentence, never raw JSON
//   • legacy / normal v2 keys keep working; expired keys stay demoted
//   • FREE_SEASON open; when it ends BYOK keeps 50/day and Owner lifts caps
//
// Run: node --test --test-force-exit tests/v1133-license-entitlement.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1133-'));
const DAY = 86_400_000;
const BASE = 1_760_000_000_000;
const abs = (rel) => join(ROOT, rel).replace(/\\/g, '/');

// ---------- isolated userData + electron stub ----------
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `module.exports = {
    app: { getPath: () => ${JSON.stringify(userDataDir)}, whenReady: async () => true, on() {}, quit() {} },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: async () => {}, showItemInFolder() {}, openPath: async () => '' },
    Notification: { isSupported: () => false },
  };`,
);

function bundle(entryPath, outPath) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, entryPath, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${outPath}`, '--external:electron'], { cwd: ROOT, stdio: 'pipe' });
  return require(outPath);
}

// ---------- main bundle (FREE_SEASON = true) ----------
const entry = join(tmp, 'entry.ts');
writeFileSync(entry, [
  `export * as license from '${abs('electron/services/licenseService.ts')}';`,
  `export * as billing from '${abs('electron/services/billingService.ts')}';`,
  `export * as store from '${abs('electron/services/storeService.ts')}';`,
].join('\n'), 'utf8');
const svc = bundle(entry, join(tmp, 'svc.cjs'));
const { license, billing, store } = svc;

// ---------- season-ended bundle (FREE_SEASON flipped to false) ----------
// Written to a temp dir with absolute import paths so no source file is edited.
const endedBillingPath = join(tmp, 'billingEnded.ts');
const originalBilling = readFileSync(join(ROOT, 'electron/services/billingService.ts'), 'utf8');
assert.match(originalBilling, /export const FREE_SEASON = true;/, 'guard: source still has the flag we flip');
writeFileSync(endedBillingPath, originalBilling
  .replace('export const FREE_SEASON = true;', 'export const FREE_SEASON = false;')
  .replace(/from '\.\/storeService'/, `from '${abs('electron/services/storeService.ts')}'`));
const endedLicensePath = join(tmp, 'licenseEnded.ts');
const originalLicense = readFileSync(join(ROOT, 'electron/services/licenseService.ts'), 'utf8');
writeFileSync(endedLicensePath, originalLicense
  .replace(/from '\.\/billingService'/, `from '${endedBillingPath.replace(/\\/g, '/')}'`)
  .replace(/from '\.\/storeService'/, `from '${abs('electron/services/storeService.ts')}'`));
const endedEntry = join(tmp, 'entryEnded.ts');
writeFileSync(endedEntry, [
  `export * as license from '${endedLicensePath.replace(/\\/g, '/')}';`,
  `export * as billing from '${endedBillingPath.replace(/\\/g, '/')}';`,
  `export * as store from '${abs('electron/services/storeService.ts')}';`,
].join('\n'), 'utf8');
const ended = bundle(endedEntry, join(tmp, 'svcEnded.cjs'));

// ---------- mocked clock (shared by both bundles) ----------
const REAL_DATE_NOW = Date.now;
const clock = { t: BASE };
Date.now = () => clock.t;

function reset() {
  for (const f of ['accounts.json', 'session.json', 'guest.json', 'license.json', 'license.key', 'settings.json']) {
    rmSync(join(userDataDir, f), { force: true });
  }
  store.invalidateSettingsCache();
  ended.store.invalidateSettingsCache();
  clock.t = BASE;
}

after(() => {
  Date.now = REAL_DATE_NOW;
  rmSync(tmp, { recursive: true, force: true });
});

/** Run the real founder CLI; return { stdout, stderr, status }. */
function mint(...args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/license-gen.cjs'), ...args],
    { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `license-gen.cjs failed: ${r.stderr}`);
  return r;
}
const KEY_RE = /KDX-(?:PRO|TEAM|OWNER|FOUNDER)-[0-9A-Z]{5}-[0-9A-Z]{4}-[0-9A-Z]{3}/;

// ============================================================
// 1 · THE FOUNDER CLI + CROSS-DEVICE LEGACY VERIFICATION
// ============================================================
test('license-gen.cjs mints a perpetual key with the documented legacy secret', () => {
  reset();
  const { stdout, stderr } = mint('--plan', 'pro', '--days', '0', '--count', '1');
  const key = stdout.match(KEY_RE)?.[0];
  assert.ok(key, `no key in CLI stdout: ${stdout}`);
  assert.match(key, /^KDX-PRO-00000-/, 'days=0 encodes to 00000');

  // Same algorithm as licenseService — verifies via the legacy secret path.
  const verdict = license.validateKey(key);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.plan, 'pro');
  assert.equal(verdict.expiryDays, 0);
  assert.equal(verdict.source, 'v2');
  assert.ok(license.decodeKeyV2(key), 'decodeKeyV2 accepts the CLI key');

  // Honest printed instructions.
  assert.match(stderr, /after payment/i);
  assert.match(stderr, /v11 series/i);
  assert.match(stderr, /50% discount on the next major/i);
  assert.match(stderr, /NOT "all future versions free forever"/);
  assert.match(stderr, /OFFLINE \+ SHAREABLE/i, 'shareability is stated, not hidden');
  assert.doesNotMatch(stderr, /\$\d+|per month/i, 'no monthly price or /mo pitch');
});

test('legacy-secret key verifies on a DIFFERENT device (fresh runtime secret)', () => {
  reset();
  const key = mint('--plan', 'pro', '--days', '0').stdout.match(KEY_RE)[0];
  // Wipe the per-device runtime secret so a NEW 0600 secret is generated.
  rmSync(join(userDataDir, 'license.secret'), { force: true });
  // Force a fresh module instance so runtimeSecretCache is re-read.
  const freshEntry = join(tmp, 'entryFresh.ts');
  writeFileSync(freshEntry, `export * as license from '${abs('electron/services/licenseService.ts')}';`);
  const freshOut = join(tmp, 'svcFresh.cjs');
  rmSync(freshOut, { force: true });
  const fresh = bundle(freshEntry, freshOut);
  assert.equal(fresh.license.validateKey(key).ok, true,
    'cross-device: legacy secret verifies even when the runtime secret differs');
});

test('CLI --plan owner / founder mint owner keys; --secret override is honored', () => {
  reset();
  const ownerKey = mint('--plan', 'owner', '--days', '0').stdout.match(KEY_RE)[0];
  assert.match(ownerKey, /^KDX-OWNER-00000-/);
  const ov = license.validateKey(ownerKey);
  assert.equal(ov.ok, true);
  assert.equal(ov.plan, 'pro', 'owner maps to the top local entitlement');
  assert.equal(ov.owner, true);

  const founderKey = mint('--plan', 'founder').stdout.match(KEY_RE)[0];
  assert.equal(license.validateKey(founderKey).owner, true);

  const custom = mint('--plan', 'pro', '--days', '0', '--secret', 'a-private-secret').stdout.match(KEY_RE)[0];
  assert.equal(license.validateKey(custom).ok, false, 'private secret is NOT the public legacy secret');
  assert.equal(license.decodeKeyV2(custom), null);
});

// ============================================================
// 2 · REDEEM → REAL ENTITLEMENT, 0600 STORAGE, HONEST ERRORS
// ============================================================
test('redeemLicense(OWNER) returns a real perpetual entitlement and stores key 0600', async () => {
  reset();
  const ownerKey = mint('--plan', 'owner', '--days', '0').stdout.match(KEY_RE)[0];
  const ent = await license.redeemLicense(ownerKey);

  assert.equal(ent.plan, 'pro');
  assert.equal(ent.label, 'Owner License (v11 series)', 'honest label, NOT "lifetime forever"');
  assert.equal(ent.perpetual, true);
  assert.equal(ent.dailyRunCap, null, 'owner lifts the BYOK daily cap');
  assert.equal(ent.byok, true);
  assert.equal(ent.nextMajorDiscountPercent, 50);
  assert.equal(ent.license.source, 'owner');
  assert.equal(ent.license.expiresAt, undefined, 'no arbitrary expiry');
  assert.equal(ent.license.licensedTo, 'Owner License (v11 series)');
  assert.equal(store.getLicense().plan, 'pro', 'plan cache refreshed for the gates');
  assert.equal(license.isOwnerLicense(store.getLicense()), true);

  // Raw key persisted; verify the 0600 mode in source (always) and on POSIX.
  const keyFile = join(userDataDir, 'license.key');
  assert.ok(existsSync(keyFile), 'verified key was stored');
  assert.equal(readFileSync(keyFile, 'utf8').trim(), ownerKey);
  assert.match(readFileSync(join(ROOT, 'electron/services/licenseService.ts'), 'utf8'),
    /writeFileSync\(verifiedKeyPath\(\),[\s\S]{0,120}mode: 0o600/, '0600 is explicit in source');
  if (process.platform !== 'win32') {
    assert.equal(statSync(keyFile).mode & 0o777, 0o600, 'POSIX file mode is 0600');
  }

  // Deactivation clears the stored key.
  await license.deactivate();
  assert.equal(existsSync(keyFile), false);
});

test('redeemLicense(bad key) throws ONE clear sentence, no raw JSON or side effects', async () => {
  reset();
  const keyFile = join(userDataDir, 'license.key');
  for (const bad of ['', 'not-a-key', 'KDX-PRO-00000-AAAA-BBB']) {
    await assert.rejects(() => license.redeemLicense(bad), (e) => {
      assert.ok(e instanceof Error, 'a real Error (not a string/blob)');
      assert.doesNotMatch(e.message, /[{}]/, 'no JSON in the user-facing error');
      assert.doesNotMatch(e.message, /Error:|at Object|stack/i, 'no stack noise');
      assert.match(e.message, /license key|signature/i, 'single clear English sentence');
      return true;
    }, `bad key rejected: ${JSON.stringify(bad)}`);
  }
  assert.equal(existsSync(keyFile), false, 'bad keys never write a key file');
  assert.equal(store.getLicense().plan, 'free');
});

test('legacy and normal v2 keys still redeem; expired keys stay demoted', async () => {
  reset();
  const legacy = await license.redeemLicense('KDX-PRO-ABCD-EFGH-IJKL');
  assert.equal(legacy.plan, 'pro');
  assert.equal(legacy.license.source, 'legacy');
  assert.equal(legacy.perpetual, true);

  const pro = await license.redeemLicense(license.buildKeyV2('pro', 30));
  assert.equal(pro.plan, 'pro');
  assert.equal(pro.license.source, 'local');
  assert.equal(pro.license.expiresAt, 30 * DAY, 'expiry epoch-DAYS → epoch-ms');
  assert.equal(pro.perpetual, false);
  assert.equal(pro.nextMajorDiscountPercent, undefined, 'only the Owner License gets the discount');

  store.saveLicense({ plan: 'pro', mode: 'local', activatedAt: BASE - 20 * DAY, expiresAt: BASE - 1000 });
  const sub = billing.overview().subscription;
  assert.equal(sub.plan, 'free');
  assert.equal(sub.status, 'canceled', 'no fake "active subscription" for an expired key');
});

// ============================================================
// 3 · GATES — FREE SEASON OPEN; AFTER IT, BYOK CAPPED / OWNER UNCAPPED
// ============================================================
test('FREE_SEASON: everything open, no paywall, two honest statements', () => {
  reset();
  for (const action of ['run', 'mcp', 'device', 'parallel', 'subagent']) {
    assert.deepEqual(billing.checkGate(action), { allowed: true }, `open in free season: ${action}`);
  }
  assert.equal(license.effectivePlan(null), 'pro');
  assert.equal(license.effectivePlan({ plan: 'free', mode: 'local' }), 'pro');
  const ov = billing.overview();
  assert.equal(ov.promo.freeSeason, true);
  assert.equal(ov.plans.length, 2, 'no extra paid tiers');
  assert.equal(ov.plans.find((p) => p.id === 'free').limits.dailyRuns, 50);
  assert.equal(billing.FREE_DAILY_RUN_CAP, 50);
});

test('season ended: BYOK capped at 50/day, Owner License lifts every cap', () => {
  reset();
  // checkGate() uses the REAL wall-clock day (new Date()), not the mocked
  // Date.now() — use the same source for the seeded usage row.
  const today = new Date().toISOString().slice(0, 10);
  const save = (planState, mcpCount = 0) => {
    ended.store.saveSettings({
      ...ended.store.getSettings(),
      planState,
      usageLog: [{ date: today, runs: 50, tokens: 0, costUsd: 0 }],
      mcpServers: Array.from({ length: mcpCount }, (_, i) => ({ enabled: true, id: `m${i}` })),
    });
  };
  const freeState = { plan: 'free', status: 'active' };
  const ownerState = { plan: 'pro', status: 'active' };

  save(freeState, 3);
  const capped = ended.billing.checkGate('run');
  assert.equal(capped.allowed, false);
  assert.match(capped.reason, /50\/day/);
  assert.match(capped.reason, /BYOK free tier/);
  assert.match(capped.reason, /Owner License/);
  assert.doesNotMatch(capped.reason, /[{}]/, 'gate reason is a clean sentence, not JSON');
  for (const action of ['mcp', 'device', 'parallel', 'subagent']) {
    const g = ended.billing.checkGate(action);
    assert.equal(g.allowed, false, `free BYOK gated: ${action}`);
    assert.match(g.reason, /Owner License/);
  }

  save(ownerState, 3);
  for (const action of ['run', 'mcp', 'device', 'parallel', 'subagent']) {
    assert.deepEqual(ended.billing.checkGate(action), { allowed: true }, `owner lifts: ${action}`);
  }

  // Owner license resolves to 'pro' even after the season, with no expiry.
  const ownerLic = { plan: 'pro', mode: 'local', licensedTo: 'Owner License (v11 series)', source: 'owner' };
  assert.equal(ended.license.effectivePlan(ownerLic), 'pro');
  assert.equal(license.effectivePlan(ownerLic), 'pro');
});
