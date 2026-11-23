// v11.33 — MONETIZATION TRUTH GUARD (diagnosis + test only; no app source here)
// ============================================================
// Verifies the six founder-facing honesty claims with REAL behavior against
// the shipped TypeScript sources (esbuild bundles, isolated userData, mocked
// clock, zero network). Static source assertions are used ONLY for UI wiring
// that has no headless entry point (which button calls which IPC).
//
//   G1  app account card: primary Sign in opens <site>/auth#pair=<6code>&mode=signin
//       via shell.openExternal; no hard-coded fake account.
//   G2  deep-link plan=pro without a VALID local license → account stays free.
//   G3  valid signed OWNER key → pro entitlement, perpetual v11 framing,
//       no fake expiry / renewal; owner marker actually persisted.
//   G4  website pricing: NO credits, NO monthly subscription, checkout off
//       while FREE_SEASON=true, checkout URL env-configurable, BYOK-free copy.
//   G5  website auth: sign-up form + license redemption field, pairing intact,
//       deep-link callback carries email/name/plan.
//   G6  no false claims: "lifetime forever", credit resale, "no proxy" contradiction.
//
// Run: node --test --test-force-exit tests/v1133-monetization.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const abs = (rel) => join(ROOT, rel).replace(/\\/g, '/');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1133-'));
const DAY = 86_400_000;
const BASE = 1_760_000_000_000; // fixed clock, independent of wall time

// ---------- isolated userData + electron stub (records openExternal) ----------
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
    shell: {
      openExternal: async (u) => { (globalThis.__OPEN_EXTERNAL__ ||= []).push(String(u)); },
      showItemInFolder() {}, openPath: async () => '',
    },
    Notification: { isSupported: () => false },
  };`,
);

// ---------- one bundle so the desktop services share module state ----------
const entry = join(tmp, 'entry.ts');
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
const svcOut = join(tmp, 'svc.cjs');
execFileSync(ESBUILD_NODE, [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
  `--outfile=${svcOut}`, '--external:electron', '--log-level=error'], { cwd: ROOT, timeout: 120000 });
const { auth, license, billing, store } = require(svcOut);

// ---------- website lib bundles (auth.ts uses localStorage + Web Crypto) ----------
const webAuthOut = join(tmp, 'web-auth.cjs');
execFileSync(ESBUILD_NODE, [ESBUILD_BIN, abs('website/lib/auth.ts'), '--bundle', '--platform=node',
  '--format=cjs', `--outfile=${webAuthOut}`, '--log-level=error'], { cwd: ROOT, timeout: 120000 });
const siteOut = join(tmp, 'site.cjs');
execFileSync(ESBUILD_NODE, [ESBUILD_BIN, abs('website/lib/site.ts'), '--bundle', '--platform=node',
  '--format=cjs', `--outfile=${siteOut}`, '--log-level=error'], { cwd: ROOT, timeout: 120000 });

// Minimal browser localStorage so website/lib/auth.ts really persists.
const webStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (webStore.has(k) ? webStore.get(k) : null),
  setItem: (k, v) => webStore.set(k, String(v)),
  removeItem: (k) => webStore.delete(k),
  clear: () => webStore.clear(),
};
const webAuth = require(webAuthOut);

// ---------- mocked clock ----------
const REAL_DATE_NOW = Date.now;
const clock = { t: BASE };
Date.now = () => clock.t;

function reset() {
  for (const f of ['accounts.json', 'session.json', 'guest.json', 'license.json', 'settings.json']) {
    rmSync(join(userDataDir, f), { force: true });
  }
  store.invalidateSettingsCache();
  clock.t = BASE;
  webStore.clear();
  globalThis.__OPEN_EXTERNAL__ = [];
}
after(() => {
  Date.now = REAL_DATE_NOW;
  rmSync(tmp, { recursive: true, force: true });
});

// ============================================================
// G1 — APP ACCOUNT CARD → WEBSITE PAIRING SIGN-IN
// ============================================================
test('G1a beginWebAuth(signin) mints a 6-char pair bound to the REAL /auth route', () => {
  reset();
  const begin = auth.beginWebAuth('signin');
  assert.match(begin.pair, /^[A-Z0-9]{6}$/, 'a six-character pair code is minted');
  assert.match(
    begin.url,
    /^https?:\/\/[^\s]+\/auth#pair=[A-Z0-9]{6}&mode=signin$/,
    'website URL is <site>/auth#pair=<6code>&mode=signin',
  );
  assert.doesNotMatch(begin.url, /\/auth\.html/, 'no stale /auth.html route');
  const signup = auth.beginWebAuth('signup');
  assert.match(signup.url, /&mode=signup$/, 'signup mode is still supported');
});

test('G1b primary Sign in is the website flow and the IPC opens it via openExternal', () => {
  const card = read('src/components/settings/AccountAuthCard.tsx');
  // The FIRST primary button in the account card must be the website
  // handshake — not a local password form (local accounts are legacy here).
  const primary = [...card.matchAll(/<Btn\b[^>]*variant="primary"[^>]*onClick=\{[^}]*\}/g)].map((m) => m[0]);
  assert.ok(primary.length > 0, 'a primary Sign in action exists');
  assert.match(primary[0], /startWebAuth\('signin'\)/, 'primary Sign in opens the website');
  assert.match(card, /api\.(?:openExternal|authWebOpen)\(res\.url\)/, 'minted URL is handed to the OS browser');
  // no hard-coded fake account synthesized on the sign-in path
  assert.doesNotMatch(card, /setAccount\(\s*\{\s*id:\s*['"]local['"]/, 'no hard-coded local account object');

  const ipc = read('electron/ipc.ts');
  assert.match(ipc, /kdx:auth:web-open[\s\S]{0,260}shell\.openExternal/, 'web-open handler calls shell.openExternal');
  const preload = read('electron/preload.ts');
  assert.match(preload, /authWebOpen[\s\S]{0,140}invoke\('kdx:auth:web-open'/, 'renderer bridge reaches that handler');
});

// ============================================================
// G2 — HONEST PLAN CLAMP ON THE DEEP LINK
// ============================================================
test('G2 deep-link plan=pro with NO license (and with an expired one) stays free', () => {
  reset();
  const b1 = auth.beginWebAuth('signin');
  const r1 = auth.completeWebAuth({ pair: b1.pair, email: 'free@example.com', name: 'Free', plan: 'pro' });
  assert.equal(r1.ok, true);
  assert.equal(r1.account.plan, 'free', 'self-asserted paid plan is clamped to free');
  assert.ok(auth.isWebAccount('free@example.com'));

  // A fake website entitlement (format-only key) must NOT create a paid app plan.
  webAuth.saveEntitlement({ key: 'KDX-PRO-00000-ABCD-EFG', plan: 'pro', expiryDays: 0, redeemedAt: Date.now() });
  const b2 = auth.beginWebAuth('signin');
  const r2 = auth.completeWebAuth({ pair: b2.pair, email: 'fake@example.com', plan: 'pro' });
  assert.equal(r2.account.plan, 'free', 'format-only website key cannot mint a paid account');

  // An expired paid license cannot back a paid account either.
  store.saveLicense({ plan: 'pro', mode: 'local', activatedAt: BASE - 20 * DAY, expiresAt: BASE - 1000 });
  const b3 = auth.beginWebAuth('signin');
  const r3 = auth.completeWebAuth({ pair: b3.pair, email: 'expired@example.com', plan: 'pro' });
  assert.equal(r3.account.plan, 'free', 'expired license → free');

  // Replay is still one-use.
  const replay = auth.completeWebAuth({ pair: b3.pair, email: 'replay@example.com' });
  assert.equal(replay.ok, false);
});

// ============================================================
// G3 — OWNER ENTITLEMENT TRUTH
// ============================================================
test('G3a signed OWNER key verifies, maps to pro, and is perpetual', async () => {
  reset();
  const key = license.buildKeyV2('owner', 0);
  assert.match(key, /^KDX-OWNER-[0-9A-Z]{5}-[0-9A-Z]{4}-[0-9A-Z]{3}$/);
  const v = license.validateKey(key);
  assert.equal(v.ok, true, 'a locally signed OWNER key validates');
  assert.equal(v.plan, 'pro', 'owner resolves to the top local entitlement');
  assert.equal(v.owner, true, 'owner flag is explicit, not inferred from "pro"');
  assert.equal(v.expiryDays, 0, 'perpetual · no expiry encoded');

  const tampered = key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A');
  assert.equal(license.validateKey(tampered).ok, false, 'bad signature is rejected');

  const state = await license.activate(key);
  assert.equal(state.plan, 'pro', 'activation grants pro entitlement');
  assert.equal(state.expiresAt, undefined, 'no fake expiry date');
  assert.equal(license.isOwnerLicense(state), true, 'activate() MUST persist the owner marker/label');
  assert.equal(license.effectivePlan(state), 'pro');
});

test('G3b owner entitlement has no fake renewal in the billing view', async () => {
  reset();
  await license.activate(license.buildKeyV2('owner', 0));
  const sub = billing.overview().subscription;
  assert.equal(sub.plan, 'pro');
  assert.equal(sub.status, 'active');
  assert.equal(sub.renewsAt, undefined, 'perpetual license must not show a renewal date');
  assert.equal(sub.trialDaysLeft, undefined, 'no fake trial countdown');

  // The honest framing constant exists and is actually used by the marker.
  assert.equal(license.OWNER_LICENSE_LABEL, 'Owner License (v11 series)');
  assert.equal(license.NEXT_MAJOR_DISCOUNT_PERCENT, 50);
  assert.match(read('electron/services/licenseService.ts'), /not marketed as ["']lifetime forever["']/i);
});

// ============================================================
// G4 — WEBSITE PRICING TRUTH
// ============================================================
test('G4a pricing sells no credits and no monthly subscription; honest BYOK copy', () => {
  const page = read('website/app/pricing/page.tsx');
  // Inspect the SELLABLE surfaces, not negated FAQ copy ("no credit packs" is honest).
  const tiers = page.split('const TIERS: Tier[] = [')[1]?.split('];')[0] ?? '';
  assert.equal((tiers.match(/num: '/g) ?? []).length, 2, 'exactly two surfaces are sold');
  // Only the sellable metadata (not negated feature copy) may be audited.
  const sellable = tiers.split('\n')
    .filter((l) => /^\s*(num|name|price|cadence|kind|cta):/.test(l) && !/\bno\s|بلا|لا /.test(l))
    .join('\n');
  assert.doesNotMatch(sellable, /credit|subscription|monthly|per month|\/\s*mo\b/i, 'no credit / subscription tier');
  assert.match(sellable, /kind: 'download'/);
  assert.match(sellable, /kind: 'license'/);
  // No positive price strings for credits or monthly billing anywhere on the page.
  assert.doesNotMatch(page, /\d[\d,]*\s*credits? for \$|1\s*credit\s*=|pay.as.you.go|\$\d+\s*\/\s*mo\b/i,
    'no credit packs / resale / monthly price');
  assert.match(page, /free forever|free, forever/i, 'BYOK is honestly free forever');
  assert.match(page, /one-time payment · no subscription/i, 'Owner License is explicitly one-time');
  assert.match(page, /no resale of inference|does not resell inference/i);
});

test('G4b checkout is disabled during FREE_SEASON and enabled only via env URL', () => {
  const page = read('website/app/pricing/page.tsx');
  assert.match(page, /SITE\.freeSeason/, 'pricing reads the real gate, not a local copy');
  assert.match(page, /checkoutReady = !FREE_SEASON && !!SITE\.checkoutUrl/);
  assert.match(page, /disabled data-checkout="owner-license"/, 'disabled button while free season');
  assert.match(page, /href=\{SITE\.checkoutUrl\}/, 'real checkout URL only when configured');

  // REAL site.ts behavior: safe default, then env overrides.
  const loadSite = () => {
    delete require.cache[require.resolve(siteOut)];
    return require(siteOut).SITE;
  };
  delete process.env.NEXT_PUBLIC_FREE_SEASON;
  delete process.env.NEXT_PUBLIC_CHECKOUT_URL;
  const safe = loadSite();
  assert.equal(safe.freeSeason, true, 'default is SAFE: season on');
  assert.equal(safe.checkoutUrl, '', 'no checkout URL by default');

  process.env.NEXT_PUBLIC_FREE_SEASON = 'false';
  process.env.NEXT_PUBLIC_CHECKOUT_URL = 'https://pay.example.com/buy-owner';
  const live = loadSite();
  assert.equal(live.freeSeason, false);
  assert.equal(live.checkoutUrl, 'https://pay.example.com/buy-owner', 'checkout URL is env-configurable');

  delete process.env.NEXT_PUBLIC_FREE_SEASON;
  delete process.env.NEXT_PUBLIC_CHECKOUT_URL;
  loadSite();
});

// ============================================================
// G5 — WEBSITE AUTH TRUTH
// ============================================================
test('G5a auth page has sign-up, local password and a license redemption field', () => {
  const page = read('website/app/auth/page.tsx');
  assert.match(page, /type="password"/, 'password field exists (hashed locally)');
  assert.match(page, /validateLicenseFormat\(licenseInput\)/, 'license redemption validates format');
  assert.match(page, /saveEntitlement\(record\)/, 'entitlement is stored locally');
  assert.match(page, /one-time/, 'license is framed as one-time');
  assert.match(page, /NOT a signature check/, 'website explicitly disclaims signature verification');
});

test('G5b pairing flow intact; deep-link callback carries email/name/plan', async (t) => {
  const page = read('website/app/auth/page.tsx');
  assert.match(page, /readPairHash\(window\.location\.hash\)/);
  assert.match(page, /\/\^\[A-Z0-9\]\{6\}\$\//, 'six-character pair code required');
  const created = await webAuth.writeAccount({
    email: 'layla@example.com', name: 'Layla', password: 'correct-horse', mode: 'signup', plan: 'free',
  });
  assert.equal(created.ok, true);
  assert.equal(created.accounts[0].plan, 'free', 'website-created account starts free');
  assert.match(created.accounts[0].hash, /^[0-9a-f]{64}$/, 'password is SHA-256 hashed in the browser');

  const vf = webAuth.validateLicenseFormat('KDX-PRO-00000-ABCD-EFG');
  assert.equal(vf.ok, true);
  assert.equal(vf.plan, 'pro');
  const url = webAuth.callbackUrl('ABC123', 'layla@example.com', 'Layla', 'pro');
  const u = new URL(url);
  assert.equal(u.protocol, 'sadeem:');
  assert.equal(u.searchParams.get('pair'), 'ABC123');
  assert.equal(u.searchParams.get('email'), 'layla@example.com');
  assert.equal(u.searchParams.get('name'), 'Layla');
  assert.equal(u.searchParams.get('plan'), 'pro', 'callback carries the self-asserted plan (app clamps it)');

  assert.match(read('website/lib/auth.ts'), /NOT[\s*]+signature verification/i,
    'website lib never claims to verify authenticity');

  // HANDOFF GAP: the app now accepts payload.lic and verifies it, but the
  // website callback still carries only plan — the pasted key never reaches
  // the app, so the website "redemption" alone cannot create a paid account.
  const appSrc = read('electron/services/authService.ts');
  if (/payload\.lic/.test(appSrc) && !/lic\s*:/.test(read('website/lib/auth.ts'))) {
    t.diagnostic('GAP: website callback carries plan only; the app supports payload.lic but the site never sends the key — pasting a key on the site does not entitle the app.');
  }
});

// ============================================================
// G7 — ADVISORY: ENFORCEABILITY OF THE "PAID" ENTITLEMENT
// ============================================================
test('G7 advisory: OWNER keys are mintable with a PUBLIC documented secret', (t) => {
  const out = execFileSync(process.execPath,
    [join(ROOT, 'scripts/license-gen.cjs'), '--plan', 'owner', '--days', '0', '--count', '1'],
    { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  const key = out.match(/KDX-OWNER-[0-9A-Z]{5}-[0-9A-Z]{4}-[0-9A-Z]{3}/)?.[0];
  assert.ok(key, 'the shipped CLI mints an OWNER key');
  const v = license.validateKey(key);
  assert.equal(v.ok, true, 'a key minted with the PUBLIC secret verifies on this device');
  assert.equal(v.owner, true);
  t.diagnostic(`ENFORCEABILITY: ${key} was minted by anyone with the repo (scripts/license-gen.cjs default public secret) and validates as OWNER. No activation server, device binding or revocation — this is an honor-system license.`);
});

// ============================================================
// G6 — NO FALSE CLAIMS
// ============================================================
test('G6 no "lifetime forever", no credit resale, no "no proxy" contradiction', (t) => {
  const shipped = [
    'website/app/pricing/page.tsx',
    'website/app/auth/page.tsx',
    'website/app/layout.tsx',
    'website/lib/auth.ts',
    'website/lib/site.ts',
    'electron/services/licenseService.ts',
    'electron/services/billingService.ts',
    'src/components/settings/BillingSection.tsx',
  ];
  // A claim inside a negation ("NOT marketed as lifetime forever") is the
  // OPPOSITE of a false claim — only flag positive, customer-facing assertions.
  const NEG = /\b(no|not|never|without|false|deliberately|بلا|لا|ليس)\b/i;
  // Documentation comments about what we DON'T claim are not customer claims.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const positiveHits = (src, re) => {
    const hits = [];
    for (const m of src.matchAll(re)) {
      const ctx = src.slice(Math.max(0, m.index - 90), m.index + m[0].length + 40);
      if (!NEG.test(ctx)) hits.push(m[0]);
    }
    return hits;
  };
  for (const file of shipped) {
    const src = stripComments(read(file));
    assert.deepEqual(positiveHits(src, /lifetime forever/gi), [], `${file}: no positive "lifetime forever" claim`);
    assert.deepEqual(positiveHits(src, /credits never expire|100 credits|1 credit =/gi), [],
      `${file}: no credit-resale language`);
  }
  // "Unlimited" is advisory: local BYOK/MCP limits are not metered, but every
  // hit is reported with file:line so the parent can audit the wording.
  const unlimited = [];
  for (const file of shipped) {
    read(file).split('\n').forEach((line, i) => {
      if (/unlimited|غير محدود/i.test(line)) unlimited.push(`${file}:${i + 1}`);
    });
  }
  t.diagnostic(`ADVISORY "unlimited" claims: ${unlimited.join(', ') || '(none)'}`);
  // The site claims BYOK does not sit behind a proxy. That is only honest if
  // the agent really talks to providers directly (no hosted inference proxy).
  const layout = read('website/app/layout.tsx');
  assert.match(layout, /does not resell inference or sit behind a proxy/);
  const providers = read('electron/agent/providers.ts');
  assert.match(providers, /fetch\(/, 'provider requests are direct HTTP calls from the device');
  assert.doesNotMatch(providers, /https?:\/\/[^\s'"]*\/api\/proxy\b/i, 'no inference-proxy endpoint shipped');
});
