// v11.31 — AUTH / LICENSE / BILLING HONESTY + OFFLINE REGRESSION SUITE
// ============================================================
// Driven against the REAL electron/services TypeScript sources (esbuild
// bundles, zero network, isolated userData, mocked clock). No Electron needed.
//
// Covers:
//   • pairing deep-link: 15-min TTL, one-use, local-account guard,
//     no fake paid plan from a self-asserted callback
//   • guest pass: device-level 7-day clock, no clock-rollback extension,
//     consumed by a real sign-in
//   • license verification: signed/legacy keys, expiry, FREE_SEASON semantics,
//     HTTPS-only remote endpoint (no cleartext key transport)
//   • plan gates / usage accounting: free season open, honest expired
//     subscription, malformed usageLog cannot produce NaN or a crash
//
// Run: node --test --test-force-exit tests/v1131-license.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1131-'));
const DAY = 86_400_000;
const BASE = 1_760_000_000_000; // fixed 2025-ish epoch, independent of wall clock

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

// ---------- one bundle so the services share module state ----------
const entry = join(tmp, 'entry.ts');
const abs = (rel) => join(ROOT, rel).replace(/\\/g, '/');
writeFileSync(
  entry,
  [
    `export * as auth from '${abs('electron/services/authService.ts')}';`,
    `export * as license from '${abs('electron/services/licenseService.ts')}';`,
    `export * as billing from '${abs('electron/services/billingService.ts')}';`,
    `export * as store from '${abs('electron/services/storeService.ts')}';`,
  ].join('\n'),
  'utf8',
);
const out = join(tmp, 'svc.cjs');
execFileSync(ESBUILD_NODE, [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
  `--outfile=${out}`, '--external:electron'], { cwd: ROOT, stdio: 'pipe' });
const { auth, license, billing, store } = require(out);

// ---------- mocked clock (global for the whole file — every service read
// must see the same instant; node:test timeouts use performance.now()) ----------
const REAL_DATE_NOW = Date.now;
const clock = { t: BASE };
Date.now = () => clock.t;
function withClock(fn) { return fn(); }
async function withClockAsync(fn) { return await fn(); }

/** Wipe every service file; keep license.secret so build/decode stay consistent. */
function reset() {
  for (const f of ['accounts.json', 'session.json', 'guest.json', 'license.json', 'settings.json']) {
    rmSync(join(userDataDir, f), { force: true });
  }
  store.invalidateSettingsCache();
  clock.t = BASE;
}

after(() => {
  Date.now = REAL_DATE_NOW;
  rmSync(tmp, { recursive: true, force: true });
});

// ============================================================
// 1 · PAIRING DEEP LINK — TTL / one-use / local-account guard
// ============================================================
test('pair code: valid inside 15 min, rejected after TTL, consumed on first use', () => {
  reset();
  const begin = withClock(() => auth.beginWebAuth('signup'));
  assert.match(begin.pair, /^[A-Z0-9]{6}$/);
  assert.ok(begin.url.endsWith(`#pair=${begin.pair}&mode=signup`), 'pair is bound to the website URL');

  clock.t = BASE + 14 * 60 * 1000;
  const ok = withClock(() => auth.completeWebAuth({ pair: begin.pair, email: 'user@example.com', name: 'User' }));
  assert.equal(ok.ok, true, 'pair still valid at 14 minutes');

  // Replay must fail even with a different identity — one-use, not multi-use.
  const replay = withClock(() => auth.completeWebAuth({ pair: begin.pair, email: 'other@example.com' }));
  assert.equal(replay.ok, false);
  assert.equal(replay.error, 'no_account');

  // A fresh pair expires after the 15-minute window.
  const begin2 = withClock(() => auth.beginWebAuth('signin'));
  clock.t = BASE + 30 * 60 * 1000; // 16 min after begin2
  const expired = withClock(() => auth.completeWebAuth({ pair: begin2.pair, email: 'late@example.com' }));
  assert.equal(expired.ok, false, 'expired pair never opens a session');
});

test('deep link cannot overwrite a local password account (name, plan, hash, id intact)', () => {
  reset();
  const reg = auth.register('Local Owner', 'local@example.com', 'correct-horse-9', 'pro');
  assert.equal(reg.ok, true);
  // Honesty: the renderer's default "pro" pick is NOT a purchase.
  assert.equal(reg.account.plan, 'free', 'self-asserted pro plan must not be persisted');
  const before = require('node:fs').readFileSync(join(userDataDir, 'accounts.json'), 'utf8');

  const b = withClock(() => auth.beginWebAuth());
  const r = withClock(() => auth.completeWebAuth({
    pair: b.pair, email: 'local@example.com', name: 'Hacked Name', plan: 'team',
  }));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'email_taken', 'failure is reported honestly, never silently paired');
  assert.equal(require('node:fs').readFileSync(join(userDataDir, 'accounts.json'), 'utf8'), before,
    'local account (including scrypt hash) is byte-for-byte unchanged');

  // The consumed pair cannot be replayed against the local account either.
  const again = withClock(() => auth.completeWebAuth({ pair: b.pair, email: 'local@example.com' }));
  assert.equal(again.ok, false);
});

test('website account: self-asserted paid plan is free unless a real license backs it', () => {
  reset();
  const b1 = withClock(() => auth.beginWebAuth());
  const r1 = withClock(() => auth.completeWebAuth({
    pair: b1.pair, email: 'web@example.com', name: 'Web User', plan: 'team',
  }));
  assert.equal(r1.ok, true);
  assert.equal(r1.account.plan, 'free', 'no receipt → no team plan');
  assert.equal(auth.isWebAccount('web@example.com'), true);

  // A currently-valid local license is the only thing that may back a paid plan.
  store.saveLicense({ plan: 'pro', mode: 'local', activatedAt: BASE });
  const b2 = withClock(() => auth.beginWebAuth());
  const r2 = withClock(() => auth.completeWebAuth({ pair: b2.pair, email: 'web@example.com', plan: 'pro' }));
  assert.equal(r2.ok, true);
  assert.equal(r2.account.plan, 'pro');

  // An EXPIRED license must not resurrect a paid account plan.
  store.saveLicense({ plan: 'pro', mode: 'local', activatedAt: BASE - 10 * DAY, expiresAt: BASE - 1000 });
  const b3 = withClock(() => auth.beginWebAuth());
  const r3 = withClock(() => auth.completeWebAuth({ pair: b3.pair, email: 'web@example.com', plan: 'pro' }));
  assert.equal(r3.account.plan, 'free');
  reset();
});

// ============================================================
// 2 · GUEST PASS — device clock, no extension, consumed by sign-in
// ============================================================
test('guest pass: 7-day device clock, re-skip cannot extend, rollback cannot extend', () => {
  reset();
  const g1 = withClock(() => auth.guestBegin());
  assert.equal(g1.ok, true);
  assert.equal(g1.daysLeft, 7);
  assert.equal(withClock(() => auth.currentAccount())?.id, 'guest');

  clock.t = BASE + 3 * DAY;
  const g2 = withClock(() => auth.guestBegin());
  assert.equal(g2.daysLeft, 4);
  assert.equal(withClock(() => auth.guestStatus()).startedAt, BASE, 're-skip kept the ORIGINAL start');

  // A clock moved backwards must never hand out a longer pass.
  clock.t = BASE - 5 * DAY;
  assert.equal(withClock(() => auth.guestStatus()).daysLeft, 7, 'clock rollback capped at TTL');

  clock.t = BASE + 7 * DAY + 1000;
  assert.equal(withClock(() => auth.guestStatus()).expired, true);
  assert.equal(withClock(() => auth.currentAccount()), null, 'expired guest → signed out (mandatory auth)');
  const g3 = withClock(() => auth.guestBegin());
  assert.equal(g3.ok, false);
  assert.equal(g3.error, 'guest_expired');
});

test('guest pass is consumed the moment a real account lands', () => {
  reset();
  withClock(() => auth.guestBegin());
  assert.equal(auth.guestStatus().active, true);
  const reg = auth.register('Real User', 'real@example.com', 'password123');
  assert.equal(reg.ok, true);
  assert.equal(auth.guestStatus().active, false);
  assert.equal(auth.guestStatus().startedAt, null);
  assert.equal(auth.currentAccount()?.id, reg.account.id);
});

// ============================================================
// 3 · LICENSE VERIFICATION + FREE SEASON
// ============================================================
test('license keys: signed v2 verifies, tamper fails, legacy shape accepted, empty rejected', () => {
  reset();
  const key = license.buildKeyV2('pro', 30);
  assert.match(key, /^KDX-PRO-[0-9A-Z]{5}-[0-9A-Z]{4}-[0-9A-Z]{3}$/);
  const ok = license.validateKey(key);
  assert.equal(ok.ok, true);
  assert.equal(ok.plan, 'pro');
  assert.equal(ok.expiryDays, 30);
  assert.equal(ok.source, 'v2');

  // Normalization is shared between decodeKeyV2 and validateKey.
  assert.equal(license.decodeKeyV2(key.toLowerCase()).plan, 'pro');
  assert.equal(license.validateKey(key.split('').reverse().join('')).ok, false);

  const tampered = key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A');
  const bad = license.validateKey(tampered);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /signature/i, 'bad signature is named explicitly, not a silent failure');

  assert.equal(license.validateKey('KDX-PRO-ABCD-EFGH-IJKL').ok, true, 'legacy unsigned key still accepted');
  assert.equal(license.validateKey('').ok, false);
});

test('license activate stores expiry in days, deactivate clears identity', async () => {
  reset();
  const state = await withClockAsync(() => license.activate(license.buildKeyV2('pro', 30)));
  assert.equal(state.plan, 'pro');
  assert.equal(state.source, 'local');
  assert.equal(state.expiresAt, 30 * DAY, 'expiry epoch-DAYS → epoch-ms');
  assert.equal(store.getLicense().plan, 'pro');

  const off = await withClockAsync(() => license.deactivate());
  assert.equal(off.plan, 'free');
  assert.equal(off.email, undefined);
  assert.equal(off.licensedTo, undefined, 'deactivation removes stale license identity');
});

test('FREE_SEASON semantics unchanged: gates open, no nag, team key honored', () => {
  assert.equal(license.effectivePlan(null), 'pro');
  assert.equal(license.effectivePlan({ plan: 'free', mode: 'local' }), 'pro');
  assert.equal(license.effectivePlan({ plan: 'pro', mode: 'local', expiresAt: BASE - DAY }), 'pro');
  assert.equal(license.effectivePlan({ plan: 'team', mode: 'local' }), 'team');

  for (const action of ['run', 'mcp', 'device', 'parallel', 'subagent']) {
    assert.deepEqual(billing.checkGate(action), { allowed: true }, `free season allows ${action}`);
  }
  const ov = billing.overview();
  assert.equal(ov.promo.freeSeason, true);
  assert.equal(ov.plans.find((p) => p.id === 'pro').available, false, 'checkout stays paused');
});

test('remote license endpoint rejects cleartext transport (key never sent over http)', () => {
  assert.equal(license.sanitizeLicenseEndpoint('http://example.com/license'), '');
  assert.equal(license.sanitizeLicenseEndpoint('ftp://example.com/license'), '');
  assert.equal(license.sanitizeLicenseEndpoint('javascript:alert(1)'), '');
  assert.equal(license.sanitizeLicenseEndpoint('https://api.example.com/license'), 'https://api.example.com/license');
  assert.match(license.sanitizeLicenseEndpoint('http://127.0.0.1:8080/hook'), /^http:\/\/127\.0\.0\.1:8080/);
  assert.match(license.sanitizeLicenseEndpoint('http://localhost:3000/hook'), /^http:\/\/localhost:3000/);
});

// ============================================================
// 4 · USAGE ACCOUNTING + HONEST BILLING VIEW
// ============================================================
test('usage aggregation tolerates malformed rows, sums once, caps at 12 months', () => {
  reset();
  const months = [];
  for (let i = 1; i <= 11; i++) months.push(`2024-${String(i).padStart(2, '0')}-15`);
  store.saveSettings({
    ...store.getSettings(),
    usageLog: [
      ...months.map((date) => ({ date, runs: 1, tokens: 1, costUsd: 0.001 })),
      { date: '2025-01-01', runs: 2, tokens: 100, costUsd: 0.005 },
      { date: '2025-01-31', runs: 3, tokens: 200, costUsd: 0.005 },
      { date: '2025-02-01', runs: '4', tokens: -5, costUsd: null }, // hostile runtime values
      { date: 'not-a-date', runs: 99, tokens: 99, costUsd: 99 },
      null,
    ].filter(Boolean),
  });
  const usage = billing.overview().usage;
  assert.equal(usage.length, 12, 'last 12 months only');
  assert.equal(usage[0].label, '2024-02', 'oldest month dropped');
  assert.equal(usage.at(-1).label, '2025-02', 'newest month last');
  const jan = usage.find((p) => p.label === '2025-01');
  assert.equal(jan.runs, 5);
  assert.equal(jan.tokens, 300);
  assert.equal(jan.costUsd, 0.01, 'rounded once, no per-row drift');
  const feb = usage.find((p) => p.label === '2025-02');
  assert.equal(feb.runs, 4, 'numeric string coerced');
  assert.equal(feb.tokens, 0, 'negative coerced to 0');
  assert.equal(feb.costUsd, 0, 'null cost coerced to 0');
  assert.ok(usage.every((p) => Number.isFinite(p.costUsd) && Number.isFinite(p.tokens)), 'no NaN ever reaches the UI');
});

test('expired paid license is NOT shown as an active Pro subscription', () => {
  reset();
  store.saveLicense({ plan: 'pro', mode: 'local', activatedAt: BASE - 20 * DAY, expiresAt: BASE - 1000 });
  const sub = billing.overview().subscription;
  assert.equal(sub.plan, 'free');
  assert.equal(sub.status, 'canceled', 'honest status — not a fake active paid plan');
  assert.equal(sub.renewsAt, undefined);

  store.saveLicense({ plan: 'pro', mode: 'local', activatedAt: BASE, expiresAt: BASE + 10 * DAY });
  const live = billing.overview().subscription;
  assert.equal(live.plan, 'pro');
  assert.equal(live.status, 'active');
  reset();
});
